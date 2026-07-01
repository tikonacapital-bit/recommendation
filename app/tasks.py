from app.core.celery_app import celery_app
from app.core.db import SessionLocal
from app.services.ingestion import fetch_and_store_stock_data
from app.services.prefilter import run_prefilter


def refresh_tickers_sync(tickers: list[str]) -> dict:
    normalized = [ticker.upper() for ticker in tickers]
    fetch_and_store_stock_data(normalized)

    db = SessionLocal()
    try:
        run = run_prefilter(db, normalized)
        return {
            "status": run.status,
            "run_id": run.id,
            "processed_count": run.processed_count or 0,
            "tickers": normalized,
        }
    finally:
        db.close()


def run_prefilter_sync(tickers: list[str] | None = None) -> dict:
    normalized = [ticker.upper() for ticker in tickers] if tickers else None
    db = SessionLocal()
    try:
        run = run_prefilter(db, normalized)
        return {
            "status": run.status,
            "run_id": run.id,
            "total_stocks": run.total_stocks or 0,
            "processed_count": run.processed_count or 0,
        }
    finally:
        db.close()


def run_agent_pipeline_sync(ticker: str) -> dict:
    from app.services.llm_synthesis import synthesize_latest_analysis
    db = SessionLocal()
    try:
        analysis = synthesize_latest_analysis(db, ticker)
        return {
            "status": "completed",
            "ticker": ticker,
            "analysis_id": analysis.id,
            "composite_score": analysis.composite_score,
            "recommendation": analysis.recommendation,
        }
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        print(f"Error running agent pipeline for {ticker}: {e}\n{tb}")
        return {
            "status": "failed",
            "ticker": ticker,
            "error": str(e),
        }
    finally:
        db.close()


def run_universe_synthesis_sync(limit: int = 50) -> dict:
    from app.models.models import Stock, StockAnalysis
    from app.services.llm_synthesis import synthesize_latest_analysis
    from sqlalchemy import desc, func, or_
    import time
    
    db = SessionLocal()
    try:
        latest_sub = (
            db.query(func.max(StockAnalysis.id).label("latest_id"))
            .group_by(StockAnalysis.stock_id)
            .subquery()
        )
        
        query = (
            db.query(Stock)
            .join(StockAnalysis, Stock.id == StockAnalysis.stock_id)
            .join(latest_sub, StockAnalysis.id == latest_sub.c.latest_id)
            .filter(
                Stock.is_active.is_(True),
                or_(
                    StockAnalysis.tier_reached == 1,
                    StockAnalysis.recommendation.in_(["BUY", "PASS_TIER_1"])
                )
            )
            .order_by(desc(StockAnalysis.composite_score))
        )
        
        high_potential_stocks = query.all()
        batch_stocks = high_potential_stocks[:limit]
        
        results = []
        for stock in batch_stocks:
            ticker = stock.ticker
            print(f"Starting paced AI universe synthesis for {ticker}...")
            try:
                analysis = synthesize_latest_analysis(db, ticker)
                results.append({
                    "ticker": ticker,
                    "status": "success",
                    "composite_score": analysis.composite_score,
                    "recommendation": analysis.recommendation
                })
            except Exception as e:
                results.append({
                    "ticker": ticker,
                    "status": "failed",
                    "error": str(e)
                })
            time.sleep(1.5)
            
        return {
            "status": "completed",
            "processed": len(results),
            "results": results
        }
    finally:
        db.close()


def scrape_screener_all_sync() -> dict:
    from app.services.screener_scrape import scrape_all_stocks_screener_data
    db = SessionLocal()
    try:
        return scrape_all_stocks_screener_data(db)
    finally:
        db.close()


if celery_app is not None:

    @celery_app.task(name="app.tasks.refresh_tickers")
    def refresh_tickers(tickers: list[str]) -> dict:
        return refresh_tickers_sync(tickers)

    @celery_app.task(name="app.tasks.run_prefilter_task")
    def run_prefilter_task(tickers: list[str] | None = None) -> dict:
        return run_prefilter_sync(tickers)

    @celery_app.task(name="app.tasks.run_agent_pipeline_task")
    def run_agent_pipeline_task(ticker: str) -> dict:
        return run_agent_pipeline_sync(ticker)

    @celery_app.task(name="app.tasks.run_universe_synthesis_task")
    def run_universe_synthesis_task(limit: int = 50) -> dict:
        return run_universe_synthesis_sync(limit)

    @celery_app.task(name="app.tasks.scrape_screener_all_task")
    def scrape_screener_all_task() -> dict:
        return scrape_screener_all_sync()

else:
    refresh_tickers = None
    run_prefilter_task = None
    run_agent_pipeline_task = None
    run_universe_synthesis_task = None
    scrape_screener_all_task = None
