import json
import os
from typing import Any

import requests
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.agents.schemas import SynthesisOutput
from app.models.models import Stock, StockAnalysis


class LLMConfigError(RuntimeError):
    pass


class LLMResponseError(RuntimeError):
    pass


def _provider() -> str:
    return os.getenv("LLM_PROVIDER", "").strip().lower()


def llm_status() -> tuple[str, str]:
    provider = _provider()
    if not provider:
        return "unconfigured", "Set LLM_PROVIDER to 'anthropic' or 'openrouter'."
    if provider == "anthropic" and not os.getenv("ANTHROPIC_API_KEY"):
        return "unconfigured", "Set ANTHROPIC_API_KEY to use Claude directly."
    if provider == "openrouter" and not os.getenv("OPENROUTER_API_KEY"):
        return "unconfigured", "Set OPENROUTER_API_KEY to use OpenRouter."
    if provider not in {"anthropic", "openrouter"}:
        return "unconfigured", "LLM_PROVIDER must be 'anthropic' or 'openrouter'."
    return "ok", f"LLM provider configured: {provider}."


def _latest_analysis(db: Session, ticker: str) -> StockAnalysis:
    stock = db.query(Stock).filter(Stock.ticker == ticker.upper()).first()
    if not stock:
        raise LookupError(f"Unknown ticker: {ticker}")

    analysis = (
        db.query(StockAnalysis)
        .filter(StockAnalysis.stock_id == stock.id)
        .order_by(desc(StockAnalysis.created_at), desc(StockAnalysis.id))
        .first()
    )
    if not analysis:
        raise LookupError(f"No analysis found for {stock.ticker}")
    return analysis


def _prompt(analysis: StockAnalysis) -> str:
    stock = analysis.stock
    payload = {
        "ticker": stock.ticker,
        "name": stock.name,
        "sector": stock.sector,
        "market_cap": stock.market_cap,
        "scores": {
            "composite": analysis.composite_score,
            "growth": analysis.growth_score,
            "durability": analysis.durability_score,
            "valuation": analysis.valuation_score,
            "technical": analysis.technical_score,
            "management_quality": analysis.mgmt_quality_score,
            "management_sentiment": analysis.mgmt_sentiment_score,
        },
        "deterministic_recommendation": analysis.recommendation,
        "tier_reached": analysis.tier_reached,
        "key_risks": analysis.key_risks or [],
        "agent_outputs": analysis.agent_outputs or {},
    }
    return (
        "You are an equity research synthesis agent. Use only the supplied data. "
        "Do not invent filings, management quotes, catalysts, or target prices. "
        "Return strict JSON matching this schema: "
        "{"
        "\"composite_score\": number 0-100, "
        "\"recommendation\": \"BUY\" | \"HOLD\" | \"AVOID\" | \"RANK_ONLY\", "
        "\"thesis_paragraph\": string, "
        "\"key_risks\": string[], "
        "\"key_catalysts\": string[], "
        "\"target_prices\": {}, "
        "\"confidence_score\": number 0-100"
        "}. "
        "Use RANK_ONLY if the deterministic screen failed or data is thin. "
        f"Data: {json.dumps(payload, default=str)}"
    )


def _extract_json(text: str) -> dict[str, Any]:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:].strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise LLMResponseError("LLM did not return JSON.")
    return json.loads(text[start : end + 1])


def _call_anthropic(prompt: str) -> str:
    try:
        from anthropic import Anthropic
    except ModuleNotFoundError as exc:
        raise LLMConfigError("Install the anthropic package to use Claude directly.") from exc

    api_key = os.getenv("ANTHROPIC_API_KEY")
    model = os.getenv("ANTHROPIC_MODEL") or os.getenv("LLM_MODEL")
    if not api_key:
        raise LLMConfigError("ANTHROPIC_API_KEY is not configured.")
    if not model:
        raise LLMConfigError("Set ANTHROPIC_MODEL or LLM_MODEL before using Claude.")

    client = Anthropic(api_key=api_key)
    response = client.messages.create(
        model=model,
        max_tokens=1500,
        temperature=0.2,
        messages=[{"role": "user", "content": prompt}],
    )
    return "".join(block.text for block in response.content if getattr(block, "type", None) == "text")


def _call_openrouter(prompt: str) -> str:
    api_key = os.getenv("OPENROUTER_API_KEY")
    model = os.getenv("OPENROUTER_MODEL") or os.getenv("LLM_MODEL")
    if not api_key:
        raise LLMConfigError("OPENROUTER_API_KEY is not configured.")
    if not model:
        raise LLMConfigError("Set OPENROUTER_MODEL or LLM_MODEL before using OpenRouter.")

    response = requests.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": os.getenv("OPENROUTER_SITE_URL", "http://127.0.0.1:8000"),
            "X-Title": os.getenv("OPENROUTER_APP_NAME", "Equity Research"),
        },
        json={
            "model": model,
            "temperature": 0.2,
            "messages": [{"role": "user", "content": prompt}],
            "response_format": {"type": "json_object"},
        },
        timeout=60,
    )
    response.raise_for_status()
    data = response.json()
    return data["choices"][0]["message"]["content"]


def synthesize_latest_analysis(db: Session, ticker: str) -> StockAnalysis:
    analysis = _latest_analysis(db, ticker)
    stock = analysis.stock

    from app.agents.graph import graph

    # Initial state
    state = {
        "ticker": stock.ticker,
        "sector": stock.sector or "General",
        "technical_score": analysis.technical_score or 50.0,
        "agent_a_output": {},
        "agent_b_output": {},
        "agent_c_output": {},
        "agent_d_output": {},
        "synthesis_output": {},
    }

    # Run LangGraph
    final_state = graph.invoke(state)

    synthesis_data = final_state.get("synthesis_output", {})
    from app.agents.schemas import SynthesisOutput
    
    # In case of missing synthesis data
    if not synthesis_data:
        synthesis_data = {
            "composite_score": 50,
            "recommendation": "RANK_ONLY",
            "thesis_paragraph": "Graph execution failed to produce output.",
            "confidence_score": 0,
            "target_prices": {}
        }
        
    synthesis = SynthesisOutput.model_validate(synthesis_data)

    existing_outputs = analysis.agent_outputs or {}
    analysis.composite_score = round(synthesis.composite_score, 2)
    analysis.recommendation = synthesis.recommendation
    analysis.thesis_paragraph = synthesis.thesis_paragraph
    analysis.key_risks = synthesis.key_risks
    analysis.key_catalysts = synthesis.key_catalysts
    analysis.target_prices = synthesis.target_prices
    analysis.confidence_score = round(synthesis.confidence_score / 100, 2)
    
    # Store Agent outputs
    analysis.agent_outputs = {
        **existing_outputs,
        "agent_a": final_state.get("agent_a_output", {}),
        "agent_b": final_state.get("agent_b_output", {}),
        "agent_c": final_state.get("agent_c_output", {}),
        "agent_d": final_state.get("agent_d_output", {}),
        "llm_synthesis": {
            "provider": _provider(),
            "model": os.getenv("ANTHROPIC_MODEL") or os.getenv("OPENROUTER_MODEL") or os.getenv("LLM_MODEL"),
            "output": synthesis.model_dump(),
        },
    }
    
    # Also update individual scores based on Agent outputs if they exist
    agent_a = final_state.get("agent_a_output", {})
    if "growth_score" in agent_a:
        analysis.growth_score = agent_a["growth_score"]
    if "durability_score" in agent_a:
        analysis.durability_score = agent_a["durability_score"]
    if "mgmt_quality_score" in agent_a:
        analysis.mgmt_quality_score = agent_a["mgmt_quality_score"]

    agent_b = final_state.get("agent_b_output", {})
    if "sector_score" in agent_b:
        analysis.sector_score = agent_b["sector_score"]

    agent_c = final_state.get("agent_c_output", {})
    if "mgmt_sentiment_score" in agent_c:
        analysis.mgmt_sentiment_score = agent_c["mgmt_sentiment_score"]

    agent_d = final_state.get("agent_d_output", {})
    if "valuation_score" in agent_d:
        analysis.valuation_score = agent_d["valuation_score"]

    db.commit()
    db.refresh(analysis)
    return analysis
