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


if celery_app is not None:

    @celery_app.task(name="app.tasks.refresh_tickers")
    def refresh_tickers(tickers: list[str]) -> dict:
        return refresh_tickers_sync(tickers)

    @celery_app.task(name="app.tasks.run_prefilter_task")
    def run_prefilter_task(tickers: list[str] | None = None) -> dict:
        return run_prefilter_sync(tickers)

else:
    refresh_tickers = None
    run_prefilter_task = None
