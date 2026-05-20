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


def _call_anthropic(prompt: str, override_model: str = None) -> str:
    try:
        from anthropic import Anthropic
    except ModuleNotFoundError as exc:
        raise LLMConfigError("Install the anthropic package to use Claude directly.") from exc

    api_key = os.getenv("ANTHROPIC_API_KEY")
    model = override_model or os.getenv("ANTHROPIC_MODEL") or os.getenv("LLM_MODEL")
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


def _call_openrouter(prompt: str, override_model: str = None) -> str:
    api_key = os.getenv("OPENROUTER_API_KEY")
    model = override_model or os.getenv("OPENROUTER_MODEL") or os.getenv("LLM_MODEL")
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


def call_llm_robust(prompt: str, max_retries: int = 5) -> str:
    """
    Unified LLM caller that handles rate limits (429) using exponential backoff with jitter,
    and automatically fails over through a list of fallback models when rate limits persist.
    """
    import time
    import random
    import requests as req_lib

    provider = _provider()
    if provider not in {"anthropic", "openrouter"}:
        raise RuntimeError("Set LLM_PROVIDER to 'anthropic' or 'openrouter'.")

    # Load fallback models from .env, or use standard resilient free models on OpenRouter
    fallback_env = os.getenv("FALLBACK_MODELS")
    if fallback_env:
        models = [m.strip() for m in fallback_env.split(",") if m.strip()]
    else:
        primary_model = os.getenv("OPENROUTER_MODEL") or os.getenv("LLM_MODEL") or "deepseek/deepseek-v4-flash:free"
        if provider == "anthropic":
            models = [
                os.getenv("ANTHROPIC_MODEL") or os.getenv("LLM_MODEL") or "claude-3-5-haiku-20241022",
                "claude-3-haiku-20240307"
            ]
        else:
            # Curious list of standard high-quality OpenRouter free models
            models = [
                primary_model,
                "google/gemini-2.5-flash:free",
                "meta-llama/llama-3.3-70b-instruct:free",
                "qwen/qwen-2.5-coder-32b-instruct:free",
                "deepseek/deepseek-r1:free",
                "mistralai/mistral-7b-instruct:free"
            ]

    # Deduplicate while preserving order
    seen = set()
    model_list = []
    for m in models:
        if m not in seen:
            seen.add(m)
            model_list.append(m)

    last_exc = None
    for model_index, model in enumerate(model_list):
        caller = _call_anthropic if provider == "anthropic" else _call_openrouter
        
        print(f"[LLM Gateway] Attempting with model: {model} (provider: {provider})")
        
        for attempt in range(max_retries):
            try:
                # Call LLM with the specified model
                return caller(prompt, override_model=model)
            except Exception as exc:
                last_exc = exc
                status_code = getattr(exc, "status_code", None)
                if not status_code and hasattr(exc, "response") and exc.response is not None:
                    status_code = getattr(exc.response, "status_code", None)
                
                # Check for 429 Rate Limit
                exc_type = type(exc).__name__
                is_rate_limit = "RateLimit" in exc_type or status_code == 429
                
                if is_rate_limit:
                    # Exponential backoff with jitter
                    base_delay = 2 ** attempt
                    jitter = random.uniform(0.5, 1.5)
                    delay = base_delay * jitter
                    print(f"[LLM Gateway] Rate-limit (429) hit on model {model}. Retrying in {delay:.2f}s (attempt {attempt+1}/{max_retries})...")
                    time.sleep(delay)
                else:
                    # Other exceptions (like parsing or API key issue) should also trigger backoff or failover
                    base_delay = 1
                    jitter = random.uniform(0.5, 1.2)
                    delay = base_delay * jitter
                    print(f"[LLM Gateway] Error ({exc_type}: {exc}) on model {model}. Retrying in {delay:.2f}s (attempt {attempt+1}/{max_retries})...")
                    time.sleep(delay)
                    
        # If we exhausted retries on this model, print failure and try the next fallback model
        print(f"[LLM Gateway] Failed with model {model} after {max_retries} attempts. Switching to fallback...")
        
    raise RuntimeError(f"All fallback models exhausted. Last error: {last_exc}")


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

    # ── structured evidence harvesting & auditing registry ───────────────────
    try:
        from app.models.models import EvidenceRegistry, Document
        
        # Clean up existing evidence for this analysis to avoid duplicates on re-runs
        db.query(EvidenceRegistry).filter(EvidenceRegistry.analysis_id == analysis.id).delete()
        
        # Collect evidence from all sub-agents
        agents_keys = ["agent_a", "agent_b", "agent_c", "agent_d"]
        for agent_key in agents_keys:
            # We fetch from analysis.agent_outputs (since they were saved as dicts) or final_state
            agent_out = analysis.agent_outputs.get(agent_key) or {}
            evidence_list = agent_out.get("evidence") or []
            for item in evidence_list:
                quote_str = item.get("quote") or ""
                source_str = item.get("source") or ""
                pillar_str = item.get("pillar") or ""
                
                if not quote_str:
                    continue
                    
                # Attempt to resolve source_doc_id
                source_doc_id = None
                if source_str:
                    try:
                        # If it's a numeric ID
                        source_doc_id = int(source_str)
                    except ValueError:
                        # Search for document of this stock that matches source_str
                        doc = db.query(Document).filter(
                            Document.stock_id == stock.id,
                            (Document.quarter.ilike(f"%{source_str}%")) | (Document.doc_type.ilike(f"%{source_str}%"))
                        ).first()
                        if doc:
                            source_doc_id = doc.id
                
                ev_record = EvidenceRegistry(
                    analysis_id=analysis.id,
                    quote=quote_str,
                    source_doc_id=source_doc_id,
                    pillar=pillar_str
                )
                db.add(ev_record)
                
        db.commit()
    except Exception as e:
        print(f"[synthesis] Failed to harvest and save evidence: {e}")
        db.rollback()

    db.refresh(analysis)
    return analysis
