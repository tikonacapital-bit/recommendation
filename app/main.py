from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import requests
from sqlalchemy import desc, func, text
from sqlalchemy.orm import Session

from app.core.celery_app import broker_status, celery_app
from app.core.db import get_db
from app.schemas import HealthResponse, RefreshResponse, RunResponse, StockAnalysisResponse, TaskResponse, TopResponse
from app.models.models import Stock, StockAnalysis
from app.services.llm_synthesis import LLMConfigError, LLMResponseError, llm_status, synthesize_latest_analysis
from app.services.prefilter import run_prefilter
from app.tasks import refresh_tickers, run_prefilter_task

app = FastAPI(title="Multi-Agent Equity Research System", version="0.1.0")
app.mount("/static", StaticFiles(directory="app/static"), name="static")


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
    db: Session = Depends(get_db),
) -> TopResponse:
    latest_per_stock = (
        db.query(func.max(StockAnalysis.id).label("analysis_id"))
        .group_by(StockAnalysis.stock_id)
        .subquery()
    )
    analyses = (
        db.query(StockAnalysis)
        .join(latest_per_stock, StockAnalysis.id == latest_per_stock.c.analysis_id)
        .join(Stock)
        .order_by(desc(StockAnalysis.composite_score), desc(StockAnalysis.created_at))
        .limit(limit)
        .all()
    )
    return TopResponse(count=len(analyses), results=[_analysis_to_response(item) for item in analyses])


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


@app.post("/synthesize/{ticker}", response_model=StockAnalysisResponse)
def synthesize_stock(ticker: str, db: Session = Depends(get_db)) -> StockAnalysisResponse:
    try:
        analysis = synthesize_latest_analysis(db, ticker)
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
