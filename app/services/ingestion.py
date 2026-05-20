import logging
import os
from datetime import datetime
from typing import Any

import pandas as pd
import yfinance as yf
from sqlalchemy import text
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

def sync_from_equity_universe() -> tuple[int, int]:
    """Sync stocks and financial data from equity_universe table.

    Maps equity_universe columns to stocks + financial_models so the
    prefilter can run without a yfinance call.
    Returns (synced_count, skipped_count).
    """
    db: Session = SessionLocal()
    synced = 0
    skipped = 0
    try:
        rows = db.execute(text("""
            SELECT nse_code, isin_code, company_name, sector, broad_sector,
                   market_cap, current_price, book_value,
                   roe, debt, net_worth, pe_ttm, pe_fy2026e,
                   revenue_cagr_hist_2yr
            FROM equity_universe
            WHERE nse_code IS NOT NULL AND nse_code != ''
        """)).fetchall()

        for row in rows:
            try:
                nse_code = row.nse_code.strip().upper()
                if not nse_code:
                    skipped += 1
                    continue
                ticker_symbol = f"{nse_code}.NS"

                market_cap_rupees = float(row.market_cap) * 1e7 if row.market_cap else None
                roe_decimal = float(row.roe) / 100 if row.roe else None
                revenue_growth = float(row.revenue_cagr_hist_2yr) / 100 if row.revenue_cagr_hist_2yr else None

                debt_to_equity = None
                if row.debt is not None and row.net_worth and float(row.net_worth) > 0:
                    debt_to_equity = float(row.debt) / float(row.net_worth)

                price_to_book = None
                if row.current_price and row.book_value and float(row.book_value) > 0:
                    price_to_book = float(row.current_price) / float(row.book_value)

                db_stock = db.query(Stock).filter(Stock.ticker == ticker_symbol).first()
                if not db_stock:
                    db_stock = Stock(
                        ticker=ticker_symbol,
                        name=row.company_name or nse_code,
                        sector=row.sector or row.broad_sector or "Unknown",
                        market_cap=market_cap_rupees,
                        isin=row.isin_code,
                        is_active=True,
                    )
                    db.add(db_stock)
                    db.flush()
                else:
                    db_stock.name = row.company_name or nse_code
                    db_stock.sector = row.sector or row.broad_sector or db_stock.sector
                    db_stock.market_cap = market_cap_rupees
                    db_stock.is_active = True

                current_period = f"FY{datetime.now().year}"
                db_fin = db.query(FinancialModel).filter(
                    FinancialModel.stock_id == db_stock.id,
                    FinancialModel.period == current_period,
                ).first()

                financials_data: dict[str, Any] = {
                    "key_ratios": {
                        "returnOnEquity": roe_decimal,
                        "revenueGrowth": revenue_growth,
                        "debtToEquity": debt_to_equity,
                        "trailingPE": float(row.pe_ttm) if row.pe_ttm else None,
                        "forwardPE": float(row.pe_fy2026e) if row.pe_fy2026e else None,
                        "priceToBook": price_to_book,
                    },
                    "source": "equity_universe",
                }

                if not db_fin:
                    db.add(FinancialModel(stock_id=db_stock.id, period=current_period, data=financials_data))
                else:
                    db_fin.data = financials_data

                synced += 1
                if synced % 100 == 0:
                    db.commit()
                    logger.info("Synced %d stocks so far…", synced)

            except Exception as exc:
                logger.warning("Skipping %s: %s", row.nse_code, exc)
                db.rollback()
                skipped += 1

        db.commit()
        logger.info("Equity universe sync complete: %d synced, %d skipped.", synced, skipped)
        return synced, skipped
    finally:
        db.close()


if __name__ == "__main__":
    test_tickers = ["RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "TATAMOTORS.NS"]
    fetch_and_store_stock_data(test_tickers)
