import logging
from datetime import datetime, timezone
from typing import Any

import pandas as pd
from sqlalchemy import desc, text
from sqlalchemy.orm import Session

from app.models.models import AnalysisRun, FinancialModel, Stock, StockAnalysis

logger = logging.getLogger(__name__)

# Legacy constants
REVENUE_GROWTH_MIN = 0.12
MIN_MARKET_CAP = 1_000_000_000


# ── Percentile helpers ────────────────────────────────────────────────────────

def _pct_rank(series: pd.Series, ascending: bool = True) -> pd.Series:
    """Universe-wide percentile rank 0–100. NaN → 50 (neutral)."""
    ranked = series.rank(pct=True, ascending=ascending, na_option="keep") * 100
    return ranked.fillna(50.0)


def _sector_pct_rank(df: pd.DataFrame, col: str, ascending: bool = True) -> pd.Series:
    """Within-sector percentile rank 0–100. NaN → 50."""
    return (
        df.groupby("sector", group_keys=False)[col]
        .transform(
            lambda s: (
                s.rank(pct=True, ascending=ascending, na_option="keep") * 100
            ).fillna(50.0)
        )
        .fillna(50.0)
    )


def _safe_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
        return None if pd.isna(f) else f
    except (TypeError, ValueError):
        return None


def _detect_risks(row: "pd.Series") -> list[str]:
    risks: list[str] = []
    nl = _safe_float(row.get("net_leverage"))
    if nl is not None and nl > 3.0:
        risks.append("high_net_leverage")
    pp = _safe_float(row.get("promoter_pct"))
    if pp is not None and pp < 30.0:
        risks.append("low_promoter_holding")
    m25 = _safe_float(row.get("ebitda_margin_fy25"))
    mttm = _safe_float(row.get("ebitda_margin_ttm"))
    if m25 is not None and mttm is not None and mttm < m25 - 2.0:
        risks.append("margin_compression")
    rc = _safe_float(row.get("rev_cagr"))
    if rc is not None and rc < 5.0:
        risks.append("low_revenue_growth")
    pf = _safe_float(row.get("pe_fwd"))
    if pf is not None and pf > 60.0:
        risks.append("expensive_valuation")
    return risks


def _detect_catalysts(row: "pd.Series") -> list[str]:
    catalysts: list[str] = []
    cu = _safe_float(row.get("consensus_upside"))
    if cu is not None and cu > 30.0:
        catalysts.append("strong_analyst_upside")
    roic = _safe_float(row.get("roic"))
    if roic is not None and roic > 20.0:
        catalysts.append("high_roic")
    rc = _safe_float(row.get("rev_cagr"))
    if rc is not None and rc > 25.0:
        catalysts.append("high_growth_trajectory")
    r3 = _safe_float(row.get("ret_3m"))
    if r3 is not None and r3 > 15.0:
        catalysts.append("strong_price_momentum")
    nl = _safe_float(row.get("net_leverage"))
    if nl is not None and nl < 0.5:
        catalysts.append("debt_free_or_net_cash")
    return catalysts


# ── Equity-Universe multi-factor prefilter ────────────────────────────────────

def _auto_detect_equity_universe(db: Session) -> bool:
    try:
        count = db.execute(text("SELECT COUNT(*) FROM equity_universe")).scalar()
        return (count or 0) > 0
    except Exception:
        return False


def _run_prefilter_from_equity_universe(
    db: Session, tickers: list[str] | None = None
) -> AnalysisRun:
    """Multi-factor prefilter reading directly from equity_universe.

    Pillars (each 0-100, percentile-ranked):
      Growth     25% — revenue CAGR, PAT CAGR, forward rev CAGR
      Quality    25% — ROIC, ROE, EBITDA margin  (sector-relative)
      Valuation  20% — consensus upside, fwd PE, fwd EV/EBITDA (PE/EV sector-relative)
      Momentum   15% — 3-month and 6-month price returns
      Health     15% — net leverage (inverse), promoter %, asset turnover
    """
    ticker_filter = ""
    params: dict = {}
    if tickers:
        nse_codes = [t.upper().removesuffix(".NS") for t in tickers]
        ticker_filter = "AND eu.nse_code = ANY(:codes)"
        params["codes"] = nse_codes

    rows = db.execute(text(f"""
        SELECT
            s.id AS stock_id, s.ticker,
            eu.company_name, eu.sector, eu.broad_sector,
            eu.revenue_cagr_hist_2yr AS rev_cagr,
            eu.pat_cagr_hist_2yr    AS pat_cagr,
            eu.revenue_cagr_fwd_2yr AS fwd_rev_cagr,
            eu.roic, eu.roe,
            eu.ebitda_margin_fy2025 AS ebitda_margin_fy25,
            eu.ebitda_margin_ttm,
            eu.pe_ttm, eu.pe_fy2026e   AS pe_fwd,
            eu.ev_ebitda_fy2026e       AS ev_ebitda_fwd,
            eu.consensus_upside_pct    AS consensus_upside,
            eu.consensus_target_price  AS consensus_tp,
            eu.target_price_high       AS tp_high,
            eu.target_price_low        AS tp_low,
            eu.return_3m AS ret_3m, eu.return_6m AS ret_6m,
            eu.net_debt, eu.ebitda_ttm AS ebitda_nd,
            eu.promoter_holding_pct    AS promoter_pct,
            eu.asset_turnover_ratio    AS asset_turnover
        FROM equity_universe eu
        JOIN stocks s ON s.ticker = eu.nse_code || '.NS' AND s.is_active = TRUE
        WHERE eu.nse_code IS NOT NULL AND eu.nse_code != ''
        {ticker_filter}
    """), params).fetchall()

    if not rows:
        raise ValueError(
            "No stocks found in equity_universe with matching stocks records — run Sync first."
        )

    col_names = [
        "stock_id", "ticker",
        "company_name", "sector", "broad_sector",
        "rev_cagr", "pat_cagr", "fwd_rev_cagr",
        "roic", "roe",
        "ebitda_margin_fy25", "ebitda_margin_ttm",
        "pe_ttm", "pe_fwd", "ev_ebitda_fwd",
        "consensus_upside", "consensus_tp", "tp_high", "tp_low",
        "ret_3m", "ret_6m",
        "net_debt", "ebitda_nd",
        "promoter_pct", "asset_turnover",
    ]
    df = pd.DataFrame(rows, columns=col_names)
    df["sector"] = df["sector"].fillna(df["broad_sector"]).fillna("Unknown")

    skip = {"stock_id", "ticker", "company_name", "sector", "broad_sector"}
    for c in col_names:
        if c not in skip:
            df[c] = pd.to_numeric(df[c], errors="coerce")

    # Net leverage — cap outliers
    df["net_leverage"] = (
        df["net_debt"] / df["ebitda_nd"].replace(0.0, float("nan"))
    ).clip(-10, 10)

    # ── Growth 25% ────────────────────────────────────────────────────────────
    g1 = _pct_rank(df["rev_cagr"])
    g2 = _pct_rank(df["pat_cagr"])
    g3 = _pct_rank(df["fwd_rev_cagr"])
    df["growth_score"] = (g1 * 0.45 + g2 * 0.35 + g3 * 0.20).clip(0, 100).round(2)

    # ── Quality 25% (sector-relative) ────────────────────────────────────────
    q1 = _sector_pct_rank(df, "roic")
    q2 = _sector_pct_rank(df, "roe")
    q3 = _sector_pct_rank(df, "ebitda_margin_fy25")
    df["quality_score"] = (q1 * 0.50 + q2 * 0.30 + q3 * 0.20).clip(0, 100).round(2)

    # ── Valuation 20% ─────────────────────────────────────────────────────────
    v1 = _pct_rank(df["consensus_upside"])                          # universe-wide
    v2 = _sector_pct_rank(df, "pe_fwd", ascending=False)           # lower = better
    v3 = _sector_pct_rank(df, "ev_ebitda_fwd", ascending=False)    # lower = better
    df["valuation_score"] = (v1 * 0.50 + v2 * 0.30 + v3 * 0.20).clip(0, 100).round(2)

    # ── Momentum 15% ──────────────────────────────────────────────────────────
    m1 = _pct_rank(df["ret_3m"])
    m2 = _pct_rank(df["ret_6m"])
    df["momentum_score"] = (m1 * 0.50 + m2 * 0.50).clip(0, 100).round(2)

    # ── Health 15% ────────────────────────────────────────────────────────────
    h1 = _pct_rank(df["net_leverage"], ascending=False)   # lower leverage = better
    h2 = _pct_rank(df["promoter_pct"])
    h3 = _sector_pct_rank(df, "asset_turnover")
    df["health_score"] = (h1 * 0.50 + h2 * 0.30 + h3 * 0.20).clip(0, 100).round(2)

    # ── Composite ─────────────────────────────────────────────────────────────
    df["composite_score"] = (
        df["growth_score"]    * 0.25
        + df["quality_score"]   * 0.25
        + df["valuation_score"] * 0.20
        + df["momentum_score"]  * 0.15
        + df["health_score"]    * 0.15
    ).clip(0, 100).round(2)

    df = df.sort_values("composite_score", ascending=False).reset_index(drop=True)
    df["rank"] = df.index + 1
    q75 = float(df["composite_score"].quantile(0.75))
    q50 = float(df["composite_score"].quantile(0.50))
    q25 = float(df["composite_score"].quantile(0.25))

    tier_1_cutoff = max(q75, 55.0)
    tier_2_cutoff = max(q50, 48.0)
    tier_3_cutoff = max(q25, 40.0)

    def get_tier(score: float) -> int | None:
        if score >= tier_1_cutoff:
            return 1
        elif score >= tier_2_cutoff:
            return 2
        elif score >= tier_3_cutoff:
            return 3
        return None

    df["tier"] = df["composite_score"].apply(get_tier)

    total = len(df)
    run = AnalysisRun(
        status="started",
        total_stocks=total,
        processed_count=0,
        run_type="prefilter_v2",
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    try:
        for _, row in df.iterrows():
            c = float(row["composite_score"])
            g = float(row["growth_score"])
            q = float(row["quality_score"])

            # Map recommendation based on dynamic cutoff and score criteria
            if c >= 68 and g >= 55 and q >= 55:
                rec = "BUY"
            elif c >= tier_1_cutoff:
                rec = "PASS_TIER_1"
            elif c >= tier_2_cutoff:
                rec = "PASS_TIER_2"
            elif c >= tier_3_cutoff:
                rec = "PASS_TIER_3"
            elif c < 38:
                rec = "AVOID"
            else:
                rec = "RANK_ONLY"

            risks = _detect_risks(row)
            catalysts = _detect_catalysts(row)

            # One-line quantitative snapshot as thesis
            def _f(v: Any, fmt: str = ".1f", suffix: str = "") -> str:
                f = _safe_float(v)
                return f"{f:{fmt}}{suffix}" if f is not None else "N/A"

            thesis = (
                f"{str(row['ticker']).removesuffix('.NS')} | {row['sector']}. "
                f"Rev CAGR {_f(row['rev_cagr'], '.1f', '%')} | "
                f"ROIC {_f(row['roic'], '.1f', '%')} | ROE {_f(row['roe'], '.1f', '%')} | "
                f"Fwd PE {_f(row['pe_fwd'], '.1f', 'x')} | "
                f"Consensus upside {_f(row['consensus_upside'], '.0f', '%')} | "
                f"3m return {_f(row['ret_3m'], '.1f', '%')}. "
                f"Score {c:.1f} → Growth {g:.0f} | Quality {q:.0f} | "
                f"Valuation {row['valuation_score']:.0f} | "
                f"Momentum {row['momentum_score']:.0f} | Health {row['health_score']:.0f}."
            )

            target_prices: dict = {}
            if _safe_float(row.get("tp_high")) is not None:
                target_prices["bull"] = _safe_float(row["tp_high"])
            if _safe_float(row.get("tp_low")) is not None:
                target_prices["bear"] = _safe_float(row["tp_low"])
            if _safe_float(row.get("consensus_tp")) is not None:
                target_prices["base"] = _safe_float(row["consensus_tp"])

            analysis = StockAnalysis(
                stock_id=int(row["stock_id"]),
                run_id=run.id,
                composite_score=c,
                growth_score=float(row["growth_score"]),
                durability_score=float(row["quality_score"]),   # Quality → durability column
                valuation_score=float(row["valuation_score"]),
                technical_score=float(row["momentum_score"]),   # Momentum → technical column
                sector_score=float(row["health_score"]),        # Health → sector column
                mgmt_quality_score=50.0,
                mgmt_sentiment_score=50.0,
                recommendation=rec,
                tier_reached=int(row["tier"]) if pd.notna(row["tier"]) else None,
                rank_in_universe=int(row["rank"]),
                confidence_score=(
                    0.72 if rec == "BUY"
                    else 0.55 if rec == "PASS_TIER_1"
                    else 0.48 if rec == "PASS_TIER_2"
                    else 0.42 if rec == "PASS_TIER_3"
                    else 0.35 if rec == "AVOID"
                    else 0.40
                ),
                thesis_paragraph=thesis,
                key_risks=risks,
                key_catalysts=catalysts,
                target_prices=target_prices,
                agent_outputs={
                    "prefilter_v2": {
                        "rev_cagr": _safe_float(row["rev_cagr"]),
                        "pat_cagr": _safe_float(row["pat_cagr"]),
                        "roic": _safe_float(row["roic"]),
                        "roe": _safe_float(row["roe"]),
                        "pe_fwd": _safe_float(row["pe_fwd"]),
                        "pe_ttm": _safe_float(row["pe_ttm"]),
                        "ev_ebitda_fwd": _safe_float(row["ev_ebitda_fwd"]),
                        "consensus_upside": _safe_float(row["consensus_upside"]),
                        "ret_3m": _safe_float(row["ret_3m"]),
                        "ret_6m": _safe_float(row["ret_6m"]),
                        "net_leverage": _safe_float(row["net_leverage"]),
                        "promoter_pct": _safe_float(row["promoter_pct"]),
                        "ebitda_margin_fy25": _safe_float(row["ebitda_margin_fy25"]),
                    }
                },
            )
            db.add(analysis)
            run.processed_count += 1

            if run.processed_count % 100 == 0:
                db.commit()
                logger.info("Scored %d / %d stocks…", run.processed_count, total)

        run.status = "completed"
        run.completed_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(run)
        logger.info("Prefilter v2 complete: %d stocks scored.", total)
        return run

    except Exception as exc:
        db.rollback()
        run.status = "failed"
        run.error_message = str(exc)
        run.completed_at = datetime.now(timezone.utc)
        db.add(run)
        db.commit()
        logger.exception("Prefilter v2 failed.")
        raise


# ── Legacy prefilter (yfinance-based) ────────────────────────────────────────

def _as_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _bounded_score(value: float | None, low: float, high: float, neutral: float = 50.0) -> float:
    if value is None:
        return neutral
    if high == low:
        return neutral
    return max(0.0, min(100.0, (value - low) / (high - low) * 100))


def _inverse_bounded_score(value: float | None, low: float, high: float, neutral: float = 50.0) -> float:
    if value is None:
        return neutral
    return 100.0 - _bounded_score(value, low, high, neutral)


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

    if hard_filter_failures:
        recommendation = "RANK_ONLY"
        tier_reached = None
    else:
        if composite_score >= 55.0:
            recommendation = "PASS_TIER_1"
            tier_reached = 1
        elif composite_score >= 48.0:
            recommendation = "PASS_TIER_2"
            tier_reached = 2
        elif composite_score >= 40.0:
            recommendation = "PASS_TIER_3"
            tier_reached = 3
        else:
            recommendation = "RANK_ONLY"
            tier_reached = None

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
        "confidence_score": (
            0.55 if recommendation == "PASS_TIER_1"
            else 0.48 if recommendation == "PASS_TIER_2"
            else 0.42 if recommendation == "PASS_TIER_3"
            else 0.25 if financial_model
            else 0.15
        ),
        "thesis_paragraph": (
            f"{stock.ticker} passed the deterministic Tier 1 screen and is ready for agent review."
            if not hard_filter_failures
            else f"{stock.ticker} remains rank-only: {', '.join(hard_filter_failures)}."
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


def _run_prefilter_legacy(db: Session, tickers: list[str] | None = None) -> AnalysisRun:
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
            analysis = StockAnalysis(stock_id=stock.id, run_id=run.id, **scores)
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
        logger.info("Legacy prefilter run %s completed for %s stocks.", run.id, len(stocks))
        return run
    except Exception as exc:
        db.rollback()
        run.status = "failed"
        run.error_message = str(exc)
        run.completed_at = datetime.now(timezone.utc)
        db.add(run)
        db.commit()
        logger.exception("Legacy prefilter run %s failed.", run.id)
        raise


# ── Public entry point ────────────────────────────────────────────────────────

def run_prefilter(db: Session, tickers: list[str] | None = None) -> AnalysisRun:
    """Route to enhanced v2 scoring (equity_universe) or legacy (yfinance) automatically."""
    if _auto_detect_equity_universe(db):
        return _run_prefilter_from_equity_universe(db, tickers)
    logger.warning("equity_universe empty — falling back to legacy yfinance-based prefilter.")
    return _run_prefilter_legacy(db, tickers)
