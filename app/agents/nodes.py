"""
app/agents/nodes.py
===================
LangGraph node functions for the 4 parallel agents + Synthesis.

State keys read   : ticker, sector, technical_score, (optionally) financial_data
State keys written: agent_a_output, agent_b_output, agent_c_output,
                    agent_d_output, synthesis_output
"""

import json
from typing import Any

from app.agents.schemas import (
    FundamentalsOutput,
    ManagementSentimentOutput,
    SectorSpecialistOutput,
    SynthesisOutput,
    ValuationRiskOutput,
)
from app.services.llm_synthesis import _call_anthropic, _call_openrouter, _provider, _extract_json


# ─────────────────────────── helpers ─────────────────────────────────────────

def _fetch_financial_snippet(ticker: str) -> dict:
    """Pull the latest financial model for a ticker from the DB (best-effort)."""
    try:
        from app.core.db import SessionLocal
        from app.models.models import Stock, FinancialModel
        from sqlalchemy import desc

        db = SessionLocal()
        try:
            stock = db.query(Stock).filter(Stock.ticker == ticker).first()
            if not stock:
                return {}
            fm = (
                db.query(FinancialModel)
                .filter(FinancialModel.stock_id == stock.id)
                .order_by(desc(FinancialModel.updated_at))
                .first()
            )
            data = fm.data if fm else {}
            ratios = data.get("key_ratios", {})
            income = data.get("income_statement", {})
            revenue_rows = income.get("Total Revenue", {})
            recent_revenue = dict(list(sorted(revenue_rows.items(), reverse=True))[:2]) if revenue_rows else {}
            return {
                "key_ratios": ratios,
                "recent_revenue": recent_revenue,
                "market_cap": stock.market_cap,
                "sector": stock.sector,
            }
        finally:
            db.close()
    except Exception as exc:
        print(f"[nodes] Could not fetch financial data for {ticker}: {exc}")
        return {}


def _call_llm(prompt: str, max_retries: int = 4) -> str:
    """Route to the configured LLM provider, retrying on 429 rate-limit errors."""
    import time
    import requests as req_lib

    provider = _provider()
    caller = _call_anthropic if provider == "anthropic" else _call_openrouter
    if provider not in {"anthropic", "openrouter"}:
        raise RuntimeError("Set LLM_PROVIDER to 'anthropic' or 'openrouter'.")

    for attempt in range(max_retries):
        try:
            return caller(prompt)
        except req_lib.exceptions.HTTPError as exc:
            if exc.response is not None and exc.response.status_code == 429:
                wait = 2 ** attempt  # 1 s, 2 s, 4 s, 8 s
                print(f"[nodes] 429 rate-limit — retrying in {wait}s (attempt {attempt+1}/{max_retries})")
                time.sleep(wait)
            else:
                raise
        except Exception as exc:
            # Anthropic SDK raises anthropic.RateLimitError (not requests.HTTPError)
            exc_type = type(exc).__name__
            status = getattr(exc, "status_code", None)
            if "RateLimit" in exc_type or status == 429:
                wait = 2 ** attempt
                print(f"[nodes] rate-limit ({exc_type}) — retrying in {wait}s (attempt {attempt+1}/{max_retries})")
                time.sleep(wait)
            else:
                raise
    raise RuntimeError(f"Rate-limit persisted after {max_retries} retries.")



def _parse_llm(raw: str, schema_class: Any) -> Any:
    """Extract JSON from raw LLM text and validate against schema_class."""
    try:
        data = _extract_json(raw)
        return schema_class.model_validate(data)
    except Exception as exc:
        print(f"[nodes] Parse error ({schema_class.__name__}): {exc}")
        return schema_class.model_construct()


def _schema_hint(schema_class: Any) -> str:
    """Return a compact JSON schema string for prompt injection."""
    try:
        schema = schema_class.model_json_schema()
        props = {k: v.get("type", "any") for k, v in schema.get("properties", {}).items()}
        return json.dumps(props)
    except Exception:
        return "{}"


# ─────────────────────────── Agent A — Fundamentals ──────────────────────────

def run_agent_a_fundamentals(state: dict) -> dict:
    ticker = state.get("ticker", "UNKNOWN")
    fin_data = _fetch_financial_snippet(ticker)

    prompt = (
        "You are Agent A, an equity fundamentals analyst for the Indian stock market. "
        "Analyse the supplied financial data and return STRICT JSON matching the schema below. "
        "Score every metric 0-100. Do NOT hallucinate numbers. "
        f"Schema: {_schema_hint(FundamentalsOutput)}\n\n"
        f"Stock: {ticker}\n"
        f"Financial data: {json.dumps(fin_data, default=str)[:2000]}"
    )

    try:
        raw = _call_llm(prompt)
        output = _parse_llm(raw, FundamentalsOutput)
    except Exception as exc:
        print(f"[agent_a] LLM call failed: {exc}")
        output = FundamentalsOutput.model_construct(
            growth_score=50.0, durability_score=50.0, mgmt_quality_score=50.0,
            summary="LLM unavailable — using neutral scores.",
        )

    return {"agent_a_output": output.model_dump(mode="json")}


# ─────────────────────────── Agent B — Sector Specialist ─────────────────────

def run_agent_b_sector(state: dict) -> dict:
    ticker = state.get("ticker", "UNKNOWN")
    sector = state.get("sector", "General")
    fin_data = _fetch_financial_snippet(ticker)

    prompt = (
        f"You are Agent B, a sector specialist for the {sector} sector in the Indian market. "
        "Analyse the supplied data and return STRICT JSON matching the schema. "
        f"Schema: {_schema_hint(SectorSpecialistOutput)}\n\n"
        f"Stock: {ticker}  Sector: {sector}\n"
        f"Financial data: {json.dumps(fin_data, default=str)[:1500]}"
    )

    try:
        raw = _call_llm(prompt)
        output = _parse_llm(raw, SectorSpecialistOutput)
    except Exception as exc:
        print(f"[agent_b] LLM call failed: {exc}")
        output = SectorSpecialistOutput.model_construct(
            sector=sector, sector_score=50.0,
            summary="LLM unavailable — using neutral scores.",
        )

    return {"agent_b_output": output.model_dump(mode="json")}


# ─────────────────────────── Agent C — Management Sentiment ──────────────────

def run_agent_c_sentiment(state: dict) -> dict:
    ticker = state.get("ticker", "UNKNOWN")

    prompt = (
        "You are Agent C, a management sentiment analyst. "
        "Based on your knowledge of this Indian listed company's recent earnings calls and management commentary, "
        "provide a sentiment assessment. Return STRICT JSON matching the schema. "
        f"Schema: {_schema_hint(ManagementSentimentOutput)}\n\n"
        f"Stock: {ticker}\n"
        "Note: No live concall data supplied — use your general knowledge of the company."
    )

    try:
        raw = _call_llm(prompt)
        output = _parse_llm(raw, ManagementSentimentOutput)
    except Exception as exc:
        print(f"[agent_c] LLM call failed: {exc}")
        output = ManagementSentimentOutput.model_construct(
            mgmt_sentiment_score=50.0, tone_shift="unknown",
            guidance_change="unknown", summary="LLM unavailable.",
        )

    return {"agent_c_output": output.model_dump(mode="json")}


# ─────────────────────────── Agent D — Valuation & Risk ──────────────────────

def run_agent_d_valuation(state: dict) -> dict:
    ticker = state.get("ticker", "UNKNOWN")
    fin_data = _fetch_financial_snippet(ticker)

    prompt = (
        "You are Agent D, a valuation and risk analyst for Indian equities. "
        "Compute fair value estimates and assess risk. Return STRICT JSON matching the schema. "
        "target_prices must contain 'bear', 'base', 'bull' keys (all floats in INR). "
        f"Schema: {_schema_hint(ValuationRiskOutput)}\n\n"
        f"Stock: {ticker}\n"
        f"Financial data: {json.dumps(fin_data, default=str)[:1500]}"
    )

    try:
        raw = _call_llm(prompt)
        output = _parse_llm(raw, ValuationRiskOutput)
    except Exception as exc:
        print(f"[agent_d] LLM call failed: {exc}")
        output = ValuationRiskOutput.model_construct(
            valuation_score=50.0,
            target_prices={"bear": 0.0, "base": 0.0, "bull": 0.0},
            summary="LLM unavailable.",
        )

    return {"agent_d_output": output.model_dump(mode="json")}


# ─────────────────────────── Synthesis Agent ─────────────────────────────────

def run_synthesis(state: dict) -> dict:
    ticker        = state.get("ticker", "UNKNOWN")
    agent_a       = state.get("agent_a_output") or {}
    agent_b       = state.get("agent_b_output") or {}
    agent_c       = state.get("agent_c_output") or {}
    agent_d       = state.get("agent_d_output") or {}
    technical_score = float(state.get("technical_score") or 50.0)

    # ── deterministic composite score (locked weights from docs) ──────────────
    growth       = float(agent_a.get("growth_score")      or 50.0)
    durability   = float(agent_a.get("durability_score")  or 50.0)
    mgmt_quality = float(agent_a.get("mgmt_quality_score")or 50.0)
    sentiment    = float(agent_c.get("mgmt_sentiment_score") or 50.0)
    valuation    = float(agent_d.get("valuation_score")   or 50.0)
    sector_score = float(agent_b.get("sector_score")      or 50.0)

    composite = (
        growth       * 0.30
        + durability   * 0.20
        + mgmt_quality * 0.20
        + sentiment    * 0.10
        + valuation    * 0.10
        + technical_score * 0.10
    )

    # ── override rule: any sub-score < 35 → cap at HOLD ──────────────────────
    min_score = min(growth, durability, mgmt_quality, sentiment, valuation, technical_score)
    override_hold = min_score < 35

    prompt = (
        "You are the Synthesis Agent for an Indian equity research system. "
        "Combine the 4 sub-agent outputs below into a 150-word investment thesis. "
        "Use the pre-calculated composite score. "
        f"{'IMPORTANT: Because one sub-score is below 35, the recommendation MUST be HOLD or AVOID.' if override_hold else ''} "
        "Return STRICT JSON matching this schema: "
        f"{_schema_hint(SynthesisOutput)}\n\n"
        f"Ticker: {ticker}\n"
        f"Composite score (pre-calculated): {round(composite, 2)}\n"
        f"Agent A (Fundamentals): {json.dumps(agent_a, default=str)[:600]}\n"
        f"Agent B (Sector):       {json.dumps(agent_b, default=str)[:300]}\n"
        f"Agent C (Sentiment):    {json.dumps(agent_c, default=str)[:300]}\n"
        f"Agent D (Valuation):    {json.dumps(agent_d, default=str)[:600]}\n"
    )

    try:
        raw = _call_llm(prompt)
        output = _parse_llm(raw, SynthesisOutput)
    except Exception as exc:
        print(f"[synthesis] LLM call failed: {exc}")
        output = SynthesisOutput.model_construct(
            composite_score=round(composite, 2),
            recommendation="RANK_ONLY",
            thesis_paragraph="Synthesis LLM unavailable — deterministic scores used.",
            confidence_score=30.0,
            target_prices=agent_d.get("target_prices") or {"bear": 0.0, "base": 0.0, "bull": 0.0},
        )

    # Force composite to the deterministic value
    output.composite_score = round(composite, 2)

    # Apply override rule
    if override_hold and output.recommendation == "BUY":
        output.recommendation = "HOLD"

    return {"synthesis_output": output.model_dump(mode="json")}
