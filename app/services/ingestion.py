import logging
import os
from datetime import datetime
from typing import Any

import pandas as pd
import yfinance as yf
from sqlalchemy.orm import Session

from app.core.db import SessionLocal
from app.models.models import FinancialModel, Stock

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def _clear_dead_local_proxy() -> None:
    """Ignore placeholder proxy settings that make yfinance call localhost:9."""
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        value = os.environ.get(key, "")
        if "127.0.0.1:9" in value or "localhost:9" in value:
            os.environ.pop(key, None)


def _safe_info(stock: yf.Ticker) -> dict[str, Any]:
    try:
        return stock.info or {}
    except Exception as exc:
        logger.warning("Could not fetch quote info: %s", exc)
        return {}


def _json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    if pd.isna(value):
        return None
    return value


def _df_to_dict(df: pd.DataFrame) -> dict:
    """Convert a yfinance DataFrame to a JSON-serializable dict.
    
    yfinance returns DataFrames with Timestamp column headers which
    cannot be serialized to PostgreSQL JSONB. This converts all keys to ISO strings.
    """
    if df is None or df.empty:
        return {}
    # Convert Timestamp column headers → ISO date strings
    df = df.copy()
    df.columns = [str(c.date()) if hasattr(c, 'date') else str(c) for c in df.columns]
    return _json_safe(df.to_dict())


def fetch_and_store_stock_data(tickers: list[str]):
    _clear_dead_local_proxy()
    db: Session = SessionLocal()
    
    for ticker_symbol in tickers:
        logger.info(f"Processing {ticker_symbol}...")
        try:
            stock = yf.Ticker(ticker_symbol)
            info = _safe_info(stock)
            
            # 1. Update or Create Stock Entry
            db_stock = db.query(Stock).filter(Stock.ticker == ticker_symbol).first()
            if not db_stock:
                db_stock = Stock(
                    ticker=ticker_symbol,
                    name=info.get('shortName', ticker_symbol),
                    sector=info.get('sector', 'Unknown'),
                    market_cap=info.get('marketCap'),
                    isin=info.get('isin'),
                )
                db.add(db_stock)
                db.commit()
                db.refresh(db_stock)
                logger.info(f"Added new stock: {ticker_symbol}")
            else:
                # Update existing
                db_stock.market_cap = info.get('marketCap', db_stock.market_cap)
                db_stock.sector = info.get('sector', db_stock.sector)
                db.commit()
                logger.info(f"Updated stock: {ticker_symbol}")

            # 2. Fetch Financials (P&L, BS, CF)
            # Use _df_to_dict() to convert Timestamp keys → ISO strings for JSONB compatibility
            financials_data = {
                "income_statement": _df_to_dict(stock.financials),
                "balance_sheet": _df_to_dict(stock.balance_sheet),
                "cash_flow": _df_to_dict(stock.cashflow),
                "key_ratios": {
                    "trailingPE": info.get("trailingPE"),
                    "forwardPE": info.get("forwardPE"),
                    "pegRatio": info.get("pegRatio"),
                    "priceToBook": info.get("priceToBook"),
                    "debtToEquity": info.get("debtToEquity"),
                    "returnOnEquity": info.get("returnOnEquity"),
                    "revenueGrowth": info.get("revenueGrowth"),
                }
            }

            if not financials_data["income_statement"] and financials_data["key_ratios"].get("revenueGrowth") is None:
                raise ValueError(f"No usable financial data returned for {ticker_symbol}")
            
            # Period: We can just use the current year as the period or 'latest'
            current_period = f"FY{datetime.now().year}"
            
            db_fin_model = db.query(FinancialModel).filter(
                FinancialModel.stock_id == db_stock.id,
                FinancialModel.period == current_period
            ).first()
            
            if not db_fin_model:
                db_fin_model = FinancialModel(
                    stock_id=db_stock.id,
                    period=current_period,
                    data=financials_data
                )
                db.add(db_fin_model)
                logger.info(f"Created new financial model for {ticker_symbol}")
            else:
                db_fin_model.data = financials_data
                logger.info(f"Updated financial model for {ticker_symbol}")
                
            db.commit()
            
        except Exception as e:
            logger.error(f"Error processing {ticker_symbol}: {str(e)}")
            db.rollback()
            
    db.close()
    logger.info("Ingestion completed.")

if __name__ == "__main__":
    # Test with a few Indian stocks (Reliance, TCS, HDFC Bank, Tata Motors)
    # yfinance uses .NS for NSE
    test_tickers = ["RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "TATAMOTORS.NS"]
    fetch_and_store_stock_data(test_tickers)
