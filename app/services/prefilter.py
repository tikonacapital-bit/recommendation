import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.models.models import AnalysisRun, FinancialModel, Stock, StockAnalysis

logger = logging.getLogger(__name__)


REVENUE_GROWTH_MIN = 0.12
MIN_MARKET_CAP = 1_000_000_000


def _as_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _latest_statement_values(statement: dict[str, Any], row_name: str) -> list[float]:
    row = statement.get(row_name) or {}
    if not isinstance(row, dict):
        return []

    ordered = sorted(row.items(), key=lambda item: str(item[0]), reverse=True)
    values: list[float] = []
    for _, raw_value in ordered:
        value = _as_float(raw_value)
        if value is not None:
            values.append(value)
    return values


def _calculate_revenue_growth(data: dict[str, Any]) -> float | None:
    ratios = data.get("key_ratios") or {}
    growth = _as_float(ratios.get("revenueGrowth"))
    if growth is not None:
        return growth

    income = data.get("income_statement") or {}
    revenue_values = _latest_statement_values(income, "Total Revenue")
    if len(revenue_values) < 2 or revenue_values[1] == 0:
        return None
    return (revenue_values[0] - revenue_values[1]) / abs(revenue_values[1])


def _bounded_score(value: float | None, low: float, high: float, neutral: float = 50.0) -> float:
    if value is None:
        return neutral
    if high == low:
        return neutral
    score = (value - low) / (high - low) * 100
    return max(0.0, min(100.0, score))


def _inverse_bounded_score(value: float | None, low: float, high: float, neutral: float = 50.0) -> float:
    if value is None:
        return neutral
    return 100.0 - _bounded_score(value, low, high, neutral)


def _latest_financial_model(db: Session, stock_id: int) -> FinancialModel | None:
    return (
        db.query(FinancialModel)
        .filter(FinancialModel.stock_id == stock_id)
        .order_by(desc(FinancialModel.updated_at), desc(FinancialModel.id))
        .first()
    )


def score_stock(stock: Stock, financial_model: FinancialModel | None) -> dict[str, Any]:
    data = financial_model.data if financial_model and financial_model.data else {}
    ratios = data.get("key_ratios") or {}

    revenue_growth = _calculate_revenue_growth(data)
    roe = _as_float(ratios.get("returnOnEquity"))
    debt_to_equity = _as_float(ratios.get("debtToEquity"))
    pe = _as_float(ratios.get("forwardPE")) or _as_float(ratios.get("trailingPE"))
    price_to_book = _as_float(ratios.get("priceToBook"))

    growth_score = _bounded_score(revenue_growth, 0.0, 0.30)
    roe_score = _bounded_score(roe, 0.05, 0.25)
    leverage_score = _inverse_bounded_score(debt_to_equity, 25.0, 200.0)
    durability_score = (roe_score * 0.65) + (leverage_score * 0.35)
    valuation_score = (
        _inverse_bounded_score(pe, 8.0, 60.0) * 0.70
        + _inverse_bounded_score(price_to_book, 1.0, 12.0) * 0.30
    )

    # Management and sentiment need filings/concall agents. Keep neutral until those agents run.
    mgmt_quality_score = 50.0
    mgmt_sentiment_score = 50.0
    technical_score = 50.0

    composite_score = (
        growth_score * 0.30
        + durability_score * 0.20
        + mgmt_quality_score * 0.20
        + mgmt_sentiment_score * 0.10
        + valuation_score * 0.10
        + technical_score * 0.10
    )

    hard_filter_failures: list[str] = []
    if revenue_growth is None:
        hard_filter_failures.append("missing_revenue_growth")
    elif revenue_growth < REVENUE_GROWTH_MIN:
        hard_filter_failures.append("revenue_growth_below_12pct")

    if stock.market_cap is None or stock.market_cap < MIN_MARKET_CAP:
        hard_filter_failures.append("liquidity_or_market_cap_below_minimum")

    recommendation = "PASS_TIER_1" if not hard_filter_failures else "RANK_ONLY"
    tier_reached = 1 if not hard_filter_failures else 0

    return {
        "composite_score": round(composite_score, 2),
        "growth_score": round(growth_score, 2),
        "durability_score": round(durability_score, 2),
        "mgmt_quality_score": mgmt_quality_score,
        "mgmt_sentiment_score": mgmt_sentiment_score,
        "valuation_score": round(valuation_score, 2),
        "technical_score": technical_score,
        "sector_score": None,
        "recommendation": recommendation,
        "tier_reached": tier_reached,
        "confidence_score": 0.45 if financial_model else 0.25,
        "thesis_paragraph": (
            f"{stock.ticker} passed the deterministic Tier 1 screen and is ready for agent review."
            if not hard_filter_failures
            else f"{stock.ticker} remains rank-only until Tier 1 issues are resolved: {', '.join(hard_filter_failures)}."
        ),
        "key_risks": hard_filter_failures,
        "key_catalysts": [],
        "target_prices": {},
        "agent_outputs": {
            "prefilter": {
                "revenue_growth": revenue_growth,
                "roe": roe,
                "debt_to_equity": debt_to_equity,
                "pe": pe,
                "price_to_book": price_to_book,
                "hard_filter_failures": hard_filter_failures,
            }
        },
    }


def run_prefilter(db: Session, tickers: list[str] | None = None) -> AnalysisRun:
    query = db.query(Stock).filter(Stock.is_active.is_(True))
    if tickers:
        query = query.filter(Stock.ticker.in_(tickers))
    stocks = query.order_by(Stock.ticker).all()

    run = AnalysisRun(
        status="started",
        total_stocks=len(stocks),
        processed_count=0,
        run_type="prefilter",
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    analyses: list[StockAnalysis] = []
    try:
        for stock in stocks:
            financial_model = _latest_financial_model(db, stock.id)
            scores = score_stock(stock, financial_model)
            analysis = StockAnalysis(
                stock_id=stock.id,
                run_id=run.id,
                **scores,
            )
            db.add(analysis)
            analyses.append(analysis)
            run.processed_count += 1

        analyses.sort(key=lambda item: item.composite_score or 0, reverse=True)
        for rank, analysis in enumerate(analyses, start=1):
            analysis.rank_in_universe = rank

        run.status = "completed"
        run.completed_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(run)
        logger.info("Prefilter run %s completed for %s stocks.", run.id, len(stocks))
        return run
    except Exception as exc:
        db.rollback()
        run.status = "failed"
        run.error_message = str(exc)
        run.completed_at = datetime.now(timezone.utc)
        db.add(run)
        db.commit()
        logger.exception("Prefilter run %s failed.", run.id)
        raise
