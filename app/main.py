from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import requests
from sqlalchemy import desc, func, or_, text
from sqlalchemy.orm import Session

from app.core.celery_app import broker_status, celery_app
from app.core.db import get_db
from app.schemas import HealthResponse, RefreshResponse, RunResponse, StockAnalysisResponse, TaskResponse, TopResponse
from app.models.models import Stock, StockAnalysis
from app.services.llm_synthesis import LLMConfigError, LLMResponseError, llm_status, synthesize_latest_analysis
from app.services.prefilter import run_prefilter
from app.tasks import refresh_tickers, run_prefilter_task, run_agent_pipeline_task, run_universe_synthesis_task

app = FastAPI(title="Multi-Agent Equity Research System", version="0.1.0")
app.mount("/static", StaticFiles(directory="app/static"), name="static")

# Nifty 50 constituents (NSE)
NIFTY_50 = [
    "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "HINDUNILVR.NS",
    "ICICIBANK.NS", "KOTAKBANK.NS", "LT.NS", "SBIN.NS", "BAJFINANCE.NS",
    "BHARTIARTL.NS", "ASIANPAINT.NS", "MARUTI.NS", "AXISBANK.NS", "ITC.NS",
    "SUNPHARMA.NS", "WIPRO.NS", "ULTRACEMCO.NS", "TITAN.NS", "NESTLEIND.NS",
    "TATAMOTORS.NS", "HCLTECH.NS", "POWERGRID.NS", "NTPC.NS", "ONGC.NS",
    "JSWSTEEL.NS", "TATASTEEL.NS", "BAJAJFINSV.NS", "ADANIPORTS.NS", "INDUSINDBK.NS",
    "EICHERMOT.NS", "DIVISLAB.NS", "DRREDDY.NS", "CIPLA.NS", "GRASIM.NS",
    "HINDALCO.NS", "COALINDIA.NS", "BPCL.NS", "TECHM.NS", "APOLLOHOSP.NS",
    "BRITANNIA.NS", "TATACONSUM.NS", "HEROMOTOCO.NS", "BAJAJ-AUTO.NS", "SBILIFE.NS",
    "HDFCLIFE.NS", "UPL.NS", "LTIM.NS", "M&M.NS", "ADANIENT.NS",
]


@app.get("/", include_in_schema=False)
def web_app() -> FileResponse:
    return FileResponse("app/static/index.html")


def _analysis_to_response(analysis: StockAnalysis) -> StockAnalysisResponse:
    stock = analysis.stock
    return StockAnalysisResponse(
        ticker=stock.ticker,
        name=stock.name,
        sector=stock.sector,
        composite_score=analysis.composite_score,
        growth_score=analysis.growth_score,
        durability_score=analysis.durability_score,
        mgmt_quality_score=analysis.mgmt_quality_score,
        mgmt_sentiment_score=analysis.mgmt_sentiment_score,
        valuation_score=analysis.valuation_score,
        technical_score=analysis.technical_score,
        sector_score=analysis.sector_score,
        recommendation=analysis.recommendation,
        thesis_paragraph=analysis.thesis_paragraph,
        key_risks=analysis.key_risks or [],
        key_catalysts=analysis.key_catalysts or [],
        target_prices=analysis.target_prices or {},
        tier_reached=analysis.tier_reached,
        rank_in_universe=analysis.rank_in_universe,
        confidence_score=analysis.confidence_score,
        agent_outputs=analysis.agent_outputs or {},
        created_at=analysis.created_at,
    )


@app.get("/health", response_model=HealthResponse)
def health(db: Session = Depends(get_db)) -> HealthResponse:
    try:
        db.execute(text("SELECT 1"))
        database = "ok"
    except Exception:
        database = "unavailable"
    return HealthResponse(status="ok", database=database)


@app.get("/worker/health", response_model=TaskResponse)
def worker_health() -> TaskResponse:
    status, message = broker_status()
    return TaskResponse(status=status, message=message)


@app.get("/llm/health", response_model=TaskResponse)
def llm_health() -> TaskResponse:
    status, message = llm_status()
    return TaskResponse(status=status, message=message)


@app.get("/top", response_model=TopResponse)
@app.get("/views/top", response_model=TopResponse)
def top(
    limit: int = Query(default=10, ge=1, le=1000),
    sector: str | None = Query(default=None, description="Filter by sector (partial match)"),
    q: str | None = Query(default=None, description="Search by ticker or company name"),
    db: Session = Depends(get_db),
) -> TopResponse:
    latest_per_stock = (
        db.query(func.max(StockAnalysis.id).label("analysis_id"))
        .group_by(StockAnalysis.stock_id)
        .subquery()
    )
    query = (
        db.query(StockAnalysis)
        .join(latest_per_stock, StockAnalysis.id == latest_per_stock.c.analysis_id)
        .join(Stock)
    )
    if sector:
        query = query.filter(Stock.sector.ilike(f"%{sector}%"))
    if q:
        query = query.filter(
            or_(Stock.ticker.ilike(f"%{q}%"), Stock.name.ilike(f"%{q}%"))
        )
    analyses = (
        query
        .order_by(desc(StockAnalysis.composite_score), desc(StockAnalysis.created_at))
        .limit(limit)
        .all()
    )
    return TopResponse(count=len(analyses), results=[_analysis_to_response(item) for item in analyses])


@app.get("/universe/sectors")
def list_sectors(db: Session = Depends(get_db)) -> dict:
    """Return sorted list of all distinct sectors in the tracked universe."""
    rows = (
        db.query(Stock.sector)
        .filter(Stock.sector.isnot(None), Stock.is_active.is_(True))
        .distinct()
        .order_by(Stock.sector)
        .all()
    )
    return {"sectors": [r[0] for r in rows if r[0]]}


@app.get("/view/{ticker}", response_model=StockAnalysisResponse)
def view_stock(ticker: str, db: Session = Depends(get_db)) -> StockAnalysisResponse:
    stock = db.query(Stock).filter(Stock.ticker == ticker.upper()).first()
    if not stock:
        raise HTTPException(status_code=404, detail=f"Unknown ticker: {ticker}")

    analysis = (
        db.query(StockAnalysis)
        .filter(StockAnalysis.stock_id == stock.id)
        .order_by(desc(StockAnalysis.created_at), desc(StockAnalysis.id))
        .first()
    )
    if not analysis:
        raise HTTPException(status_code=404, detail=f"No analysis found for {stock.ticker}")
    return _analysis_to_response(analysis)


from typing import Union

@app.post("/synthesize/{ticker}", response_model=Union[StockAnalysisResponse, TaskResponse])
def synthesize_stock(
    ticker: str,
    async_task: bool = Query(default=False, description="Queue the run in Celery instead of running inline."),
    db: Session = Depends(get_db)
) -> Union[StockAnalysisResponse, TaskResponse]:
    normalized_ticker = ticker.upper()
    if async_task and run_agent_pipeline_task is not None:
        broker_state, broker_message = broker_status()
        if broker_state == "ok":
            task = run_agent_pipeline_task.delay(normalized_ticker)
            return TaskResponse(
                status="queued",
                task_id=task.id,
                message=f"Multi-agent equity research synthesis queued for {normalized_ticker}.",
            )
        else:
            # broker offline, fallback to inline
            print(f"Broker offline ({broker_message}), falling back to inline synthesis")
            
    try:
        analysis = synthesize_latest_analysis(db, normalized_ticker)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except LLMConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (LLMResponseError, ValueError, KeyError, requests.RequestException) as exc:
        raise HTTPException(status_code=502, detail=f"LLM synthesis failed: {exc}") from exc
    return _analysis_to_response(analysis)


@app.post("/prefilter/run", response_model=RunResponse | TaskResponse)
def start_prefilter(
    async_task: bool = Query(default=False, description="Queue the run in Celery instead of running inline."),
    db: Session = Depends(get_db),
) -> RunResponse | TaskResponse:
    if async_task and run_prefilter_task is not None:
        broker_state, broker_message = broker_status()
        if broker_state != "ok":
            return TaskResponse(
                status="unavailable",
                message=f"Cannot queue prefilter: {broker_message}",
            )
        task = run_prefilter_task.delay()
        return TaskResponse(
            status="queued",
            task_id=task.id,
            message="Tier 1 prefilter queued.",
        )

    run = run_prefilter(db)
    return RunResponse(
        run_id=run.id,
        status=run.status,
        total_stocks=run.total_stocks or 0,
        processed_count=run.processed_count or 0,
    )


@app.post("/refresh/{ticker}", response_model=RefreshResponse)
def refresh_ticker(ticker: str) -> RefreshResponse:
    normalized_ticker = ticker.upper()
    if refresh_tickers is not None:
        broker_state, _ = broker_status()
        if broker_state != "ok":
            from app.tasks import refresh_tickers_sync

            refresh_tickers_sync([normalized_ticker])
            return RefreshResponse(
                status="completed",
                ticker=normalized_ticker,
                message="Refresh completed inline because Redis/Celery broker is unavailable.",
            )

        task = refresh_tickers.delay([normalized_ticker])
        return RefreshResponse(
            status="queued",
            ticker=normalized_ticker,
            task_id=task.id,
            message="Ingestion and Tier 1 prefilter refresh queued.",
        )

    from app.tasks import refresh_tickers_sync

    refresh_tickers_sync([normalized_ticker])
    return RefreshResponse(
        status="completed",
        ticker=normalized_ticker,
        message="Ingestion and Tier 1 prefilter refresh completed inline because Celery is not installed.",
    )


@app.post("/stocks/sync")
def sync_stocks(db: Session = Depends(get_db)) -> dict:
    """Sync all stocks from the equity_universe Supabase table."""
    from app.services.ingestion import sync_from_equity_universe
    synced, skipped = sync_from_equity_universe()
    total = db.query(Stock).filter(Stock.is_active.is_(True)).count()
    return {
        "status": "ok",
        "synced": synced,
        "skipped": skipped,
        "total_tracked": total,
        "message": f"Synced {synced} stocks from equity_universe ({skipped} skipped). {total} stocks now tracked.",
    }


@app.post("/stocks/seed")
def seed_stocks(db: Session = Depends(get_db)) -> dict:
    """Sync from the equity_universe table first. Fallback to Nifty 50 only if empty or error."""
    from app.services.ingestion import sync_from_equity_universe, fetch_and_store_stock_data
    synced = 0
    skipped = 0
    try:
        synced, skipped = sync_from_equity_universe()
    except Exception as exc:
        print(f"Error syncing from equity_universe, falling back to legacy seed: {exc}")
        
    if synced == 0:
        fetch_and_store_stock_data(NIFTY_50)
        total = db.query(Stock).filter(Stock.is_active.is_(True)).count()
        return {
            "status": "ok",
            "seeded": len(NIFTY_50),
            "total_tracked": total,
            "message": f"Seeded {len(NIFTY_50)} Nifty 50 stocks (legacy fallback). {total} stocks now tracked.",
        }
    else:
        total = db.query(Stock).filter(Stock.is_active.is_(True)).count()
        return {
            "status": "ok",
            "synced": synced,
            "skipped": skipped,
            "total_tracked": total,
            "message": f"Synced {synced} stocks from equity_universe. {total} stocks now tracked.",
        }


@app.post("/pipeline/full")
def run_full_pipeline(db: Session = Depends(get_db)) -> dict:
    """Sync equity_universe, then immediately run the Tier-1 prefilter. One-click setup."""
    from app.services.ingestion import sync_from_equity_universe
    synced, skipped = sync_from_equity_universe()
    run = run_prefilter(db)
    return {
        "status": run.status,
        "synced": synced,
        "skipped": skipped,
        "run_id": run.id,
        "total_stocks": run.total_stocks or 0,
        "processed_count": run.processed_count or 0,
        "message": f"Synced {synced} stocks from equity_universe and ran Tier-1 prefilter. {run.processed_count} stocks scored.",
    }


@app.post("/pipeline/run_ai_universe", response_model=TaskResponse)
def run_ai_universe(
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db)
) -> TaskResponse:
    """Trigger background batch AI synthesis for all prefiltered high-potential stocks (tier_reached = 1)."""
    from app.tasks import run_universe_synthesis_task
    if run_universe_synthesis_task is not None:
        broker_state, broker_message = broker_status()
        if broker_state != "ok":
            from app.tasks import run_universe_synthesis_sync
            print(f"Broker offline ({broker_message}), running universe synthesis task inline...")
            res = run_universe_synthesis_sync(limit=limit)
            return TaskResponse(
                status="SUCCESS",
                task_id="inline-run",
                message=f"Universe synthesis run completed inline: {res['processed']} stocks processed.",
            )
            
        task = run_universe_synthesis_task.delay(limit)
        return TaskResponse(
            status="queued",
            task_id=task.id,
            message=f"Background bulk AI universe synthesis queued for up to {limit} stocks.",
        )
    else:
        from app.tasks import run_universe_synthesis_sync
        res = run_universe_synthesis_sync(limit=limit)
        return TaskResponse(
            status="SUCCESS",
            task_id="inline-run",
            message=f"Universe synthesis run completed inline (no Celery): {res['processed']} stocks processed.",
        )


@app.get("/tasks/{task_id}", response_model=TaskResponse)
def task_status(task_id: str) -> TaskResponse:
    if celery_app is None:
        return TaskResponse(
            status="unavailable",
            task_id=task_id,
            message="Celery is not installed in this Python environment.",
        )
    broker_state, broker_message = broker_status()
    if broker_state != "ok":
        return TaskResponse(
            status="unavailable",
            task_id=task_id,
            message=broker_message,
        )

    result = celery_app.AsyncResult(task_id)
    return TaskResponse(
        status=result.status,
        task_id=task_id,
        message=str(result.result) if result.ready() and result.result else "Task is not finished.",
    )


@app.get("/analysis/{analysis_id}/evidence")
def get_analysis_evidence(analysis_id: int, db: Session = Depends(get_db)) -> dict:
    from app.models.models import EvidenceRegistry
    items = db.query(EvidenceRegistry).filter(EvidenceRegistry.analysis_id == analysis_id).all()
    return {
        "analysis_id": analysis_id,
        "evidence": [
            {
                "id": item.id,
                "quote": item.quote,
                "pillar": item.pillar,
                "source_doc_id": item.source_doc_id
            } for item in items
        ]
    }


@app.get("/stock/{ticker}/predictions")
def get_stock_predictions(ticker: str, db: Session = Depends(get_db)) -> dict:
    from app.models.models import Stock, PredictionTracking
    stock = db.query(Stock).filter(Stock.ticker == ticker.upper()).first()
    if not stock:
        raise HTTPException(status_code=404, detail=f"Unknown ticker: {ticker}")
        
    items = db.query(PredictionTracking).filter(PredictionTracking.stock_id == stock.id).order_by(desc(PredictionTracking.evaluated_at)).all()
    return {
        "ticker": ticker.upper(),
        "predictions": [
            {
                "id": item.id,
                "analysis_id": item.analysis_id,
                "predicted_price": item.predicted_price,
                "actual_price": item.actual_price,
                "error_margin": item.error_margin,
                "evaluated_at": item.evaluated_at
            } for item in items
        ]
    }
