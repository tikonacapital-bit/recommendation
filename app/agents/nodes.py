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
    """Pull rich financial data for a ticker, preferring equity_universe over FinancialModel."""
    nse_code = ticker.upper().removesuffix(".NS")
    try:
        from app.core.db import SessionLocal
        from app.models.models import Stock, FinancialModel
        from sqlalchemy import desc, text

        db = SessionLocal()
        try:
            # Try equity_universe first — much richer data
            row = db.execute(text("""
                SELECT company_name, sector, market_cap, current_price,
                       revenue_cagr_hist_2yr, pat_cagr_hist_2yr, eps_cagr_hist_2yr,
                       roic, roe, roce,
                       ebitda_margin_fy2025, ebitda_margin_ttm,
                       pe_ttm, pe_fy2026e, ev_ebitda_ttm, ev_ebitda_fy2026e,
                       consensus_upside_pct, consensus_target_price,
                       target_price_high, target_price_low,
                       return_1m, return_3m, return_6m, return_12m,
                       net_debt, debt, net_worth, promoter_holding_pct,
                       revenue_fy2023, revenue_fy2024, revenue_fy2025, revenue_ttm,
                       ebitda_fy2023, ebitda_fy2024, ebitda_fy2025, ebitda_ttm,
                       pat_fy2023, pat_fy2024, pat_fy2025, pat_ttm,
                       eps_fy2023, eps_fy2024, eps_fy2025, eps_ttm
                FROM equity_universe WHERE nse_code = :code LIMIT 1
            """), {"code": nse_code}).fetchone()

            if row:
                def _f(v):
                    try:
                        return float(v) if v is not None else None
                    except (TypeError, ValueError):
                        return None

                return {
                    "company": row.company_name,
                    "sector": row.sector,
                    "market_cap_cr": _f(row.market_cap),
                    "current_price": _f(row.current_price),
                    "growth": {
                        "revenue_cagr_2yr_pct": _f(row.revenue_cagr_hist_2yr),
                        "pat_cagr_2yr_pct": _f(row.pat_cagr_hist_2yr),
                        "eps_cagr_2yr_pct": _f(row.eps_cagr_hist_2yr),
                        "revenue_trend_cr": {
                            "FY23": _f(row.revenue_fy2023), "FY24": _f(row.revenue_fy2024),
                            "FY25": _f(row.revenue_fy2025), "TTM": _f(row.revenue_ttm),
                        },
                        "pat_trend_cr": {
                            "FY23": _f(row.pat_fy2023), "FY24": _f(row.pat_fy2024),
                            "FY25": _f(row.pat_fy2025), "TTM": _f(row.pat_ttm),
                        },
                        "ebitda_trend_cr": {
                            "FY23": _f(row.ebitda_fy2023), "FY24": _f(row.ebitda_fy2024),
                            "FY25": _f(row.ebitda_fy2025), "TTM": _f(row.ebitda_ttm),
                        },
                    },
                    "quality": {
                        "roic_pct": _f(row.roic),
                        "roe_pct": _f(row.roe),
                        "roce_pct": _f(row.roce),
                        "ebitda_margin_fy25_pct": _f(row.ebitda_margin_fy2025),
                        "ebitda_margin_ttm_pct": _f(row.ebitda_margin_ttm),
                        "promoter_holding_pct": _f(row.promoter_holding_pct),
                    },
                    "valuation": {
                        "pe_ttm": _f(row.pe_ttm),
                        "pe_fy26e": _f(row.pe_fy2026e),
                        "ev_ebitda_ttm": _f(row.ev_ebitda_ttm),
                        "ev_ebitda_fy26e": _f(row.ev_ebitda_fy2026e),
                        "consensus_upside_pct": _f(row.consensus_upside_pct),
                        "consensus_target_price": _f(row.consensus_target_price),
                        "target_high": _f(row.target_price_high),
                        "target_low": _f(row.target_price_low),
                    },
                    "momentum": {
                        "ret_1m_pct": _f(row.return_1m),
                        "ret_3m_pct": _f(row.return_3m),
                        "ret_6m_pct": _f(row.return_6m),
                        "ret_12m_pct": _f(row.return_12m),
                    },
                    "balance_sheet": {
                        "net_debt_cr": _f(row.net_debt),
                        "debt_cr": _f(row.debt),
                        "net_worth_cr": _f(row.net_worth),
                    },
                }

            # Fallback: FinancialModel (yfinance data)
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


def _call_llm(prompt: str, max_retries: int = 5) -> str:
    """Route to the robust high-resilience LLM gateway."""
    from app.services.llm_synthesis import call_llm_robust
    return call_llm_robust(prompt, max_retries=max_retries)



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
        "You are Agent A, a rigorous institutional-grade equity fundamentals analyst specializing in the Indian stock market.\n"
        "Your objective is to analyze the supplied financial data thoroughly and score key fundamental pillars. "
        "Return STRICT JSON matching the provided schema. Do NOT hallucinate or make up any numbers.\n\n"
        "Scoring Guidelines (0-100):\n"
        "- Growth Score: Assess revenue, EBITDA, and PAT CAGRs. 2-year CAGR > 20% earns 80-95. CAGR 10-20% earns 60-80. Negative or stagnant growth should be scored below 40.\n"
        "- Durability Score (Quality): Evaluate return ratios (ROE, ROIC, ROCE) and promoter holdings. Return ratios > 18-20% combined with stable promoter holdings (>50%) indicates high quality (score 80-95). Debt-to-Equity net leverage > 3.0x reduces durability heavily.\n"
        "- Management Quality Score: Review promoter shareholding levels, leverage management, and overall operational consistency. Low promoter shareholding (<35%) or massive debt-to-worth levels reflect lower management quality (score below 45).\n\n"
        "Instructions:\n"
        "1. Write a highly analytical, dense summary highlighting specific CAGRs, return ratios, and balance sheet strength.\n"
        "2. Identify internal tensions (contradictory indicators, e.g., high revenue growth but declining margins, or high profitability but excessive debt).\n"
        "3. Provide direct evidence item(s) from the data. Set 'source' to 'Financial Data' and 'pillar' to 'Fundamentals'.\n\n"
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

def _get_sector_analyst_instructions(sector: str) -> str:
    s = sector.lower()
    if any(k in s for k in ("bank", "finan", "bfsi", "capital", "insurance", "investment")):
        return (
            "You are a highly analytical BFSI (Banking & Financial Services) specialist.\n"
            "Assess operational health and assign a 'sector_score' based on standard Indian banking benchmarks:\n"
            "- Net Interest Margin (NIM) trends (margins >3.5% indicate strong pricing power).\n"
            "- Asset quality: Gross NPA (<3.0% is healthy, >5.0% is high risk) and Net NPA trends.\n"
            "- Provision Coverage Ratio (PCR) (levels >70% indicate robust safety buffers).\n"
            "- Capital adequacy: CET-1 and CAR ratios against regulatory norms.\n"
            "Return these precise parsed metrics in your 'sector_kpis' dictionary."
        )
    elif any(k in s for k in ("tech", "software", "information", "it ", "telecom")):
        return (
            "You are an expert Technology and IT services analyst.\n"
            "Assess operational quality and assign a 'sector_score' based on software sector KPIs:\n"
            "- Constant Currency (CC) growth (growth >12-15% is strong in the current environment).\n"
            "- Deal pipeline: Large deal TCV trends and client tier expansion.\n"
            "- HR metrics: LTM attrition levels (stable attrition is <15%) and offshore/onshore delivery mix.\n"
            "- Generative AI pipeline and digital offerings velocity.\n"
            "Return these precise parsed metrics in your 'sector_kpis' dictionary."
        )
    elif any(k in s for k in ("pharma", "health", "bio", "hospital", "medical")):
        return (
            "You are a specialized Healthcare and Pharmaceuticals analyst.\n"
            "Assess regulatory and commercial health to assign a 'sector_score' using these parameters:\n"
            "- USFDA compliance: Facility inspection ratings, warning letters, or import alerts (severe risks).\n"
            "- Pipeline strength: ANDA filings, key approvals, and generic/biosimilar launch schedules.\n"
            "- Cost and mix: R&D expenses as % of sales and domestic formulation vs export revenue split.\n"
            "Return these precise parsed metrics in your 'sector_kpis' dictionary."
        )
    elif any(k in s for k in ("consumer", "fmcg", "retail", "food", "beverage", "brand")):
        return (
            "You are a veteran FMCG & Consumer Retail specialist.\n"
            "Assess pricing power and logistics efficiency to assign a 'sector_score' using:\n"
            "- Volume growth vs pricing growth (real volume growth >5-8% is key to long-term health).\n"
            "- Gross margin expansion and vulnerability to raw material costs (palm oil, crude, packaging).\n"
            "- Distribution reach: Omnichannel contribution (quick-commerce and e-commerce penetration).\n"
            "Return these precise parsed metrics in your 'sector_kpis' dictionary."
        )
    elif any(k in s for k in ("auto", "vehicle", "manufacturing", "industrial", "steel", "cement", "metal", "power", "energy")):
        return (
            "You are an expert Industrials & Manufacturing sector specialist.\n"
            "Assess capital allocation and operating leverage to assign a 'sector_score' using:\n"
            "- Capacity utilization rates (>75-80% reflects strong market demand triggering operating leverage).\n"
            "- Input commodity price volatility (steel, rubber, coking coal) impacting EBITDA margins.\n"
            "- Order book visibility: Book-to-bill ratios and Capex gestation timelines.\n"
            "Return these precise parsed metrics in your 'sector_kpis' dictionary."
        )
    else:
        return (
            "You are a general Equity Sector Analyst.\n"
            "Assess competitive positioning and assign a 'sector_score' by analyzing:\n"
            "- Market share expansion or contraction against direct competitors.\n"
            "- Pricing power and presence of clear economic moats.\n"
            "- Capex efficiency, ROCE trends, and industrial cycle tailwinds/headwinds.\n"
            "Return these precise parsed metrics in your 'sector_kpis' dictionary."
        )

def run_agent_b_sector(state: dict) -> dict:
    ticker = state.get("ticker", "UNKNOWN")
    sector = state.get("sector", "General")
    fin_data = _fetch_financial_snippet(ticker)
    
    # Fetch high-fidelity sector specialist instructions
    sector_instructions = _get_sector_analyst_instructions(sector)

    prompt = (
        f"You are Agent B, a sector specialist for the {sector} sector in the Indian market.\n"
        f"Instructions: {sector_instructions}\n"
        "Analyze the supplied financial snippet and return STRICT JSON matching the schema.\n"
        "Your 'sector_kpis' dictionary should contain the exact numeric or string metrics analyzed (e.g., NIM, TCV, Attrition, warning_letters, gross_margin, capacity_utilization, etc.).\n"
        f"Schema: {_schema_hint(SectorSpecialistOutput)}\n\n"
        f"Stock: {ticker}  Sector: {sector}\n"
        f"Financial data: {json.dumps(fin_data, default=str)[:2000]}"
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

def _retrieve_concall_chunks(ticker: str) -> list[dict]:
    """
    Perform a vector similarity search (using pgvector) to fetch relevant concall transcript chunks
    for a given ticker. Gracefully falls back to chronological chunk loading if similarity search fails.
    Returns a list of dictionaries with 'content' and 'doc_id'.
    """
    from app.core.db import SessionLocal
    from app.models.models import Stock, Document, DocumentChunk
    from app.services.embeddings import get_embedding
    
    db = SessionLocal()
    chunks = []
    try:
        # 1. Check if stock exists
        stock = db.query(Stock).filter(Stock.ticker == ticker.upper()).first()
        if not stock:
            return []
            
        # 2. Compute query embedding focusing on management sentiment & outlook
        query_str = f"{ticker} earnings call management sentiment guidance revenue margin trajectory outlook"
        query_emb = get_embedding(query_str)
        
        # 3. Query pgvector similarity search
        try:
            cosine_dist = DocumentChunk.embedding.cosine_distance(query_emb)
            results = (
                db.query(DocumentChunk, Document.quarter)
                .join(Document, DocumentChunk.document_id == Document.id)
                .filter(Document.stock_id == stock.id)
                .order_by(cosine_dist)
                .limit(4)
                .all()
            )
            for res_chunk, quarter in results:
                chunks.append({
                    "content": res_chunk.content,
                    "doc_id": str(res_chunk.document_id),
                    "quarter": quarter
                })
        except Exception as e:
            # Fallback to fetching latest chunks chronologically
            print(f"[nodes] Vector similarity search failed: {e}. Falling back to chronological chunk loading.")
            results = (
                db.query(DocumentChunk, Document.quarter)
                .join(Document, DocumentChunk.document_id == Document.id)
                .filter(Document.stock_id == stock.id)
                .order_by(DocumentChunk.id.desc())
                .limit(4)
                .all()
            )
            for res_chunk, quarter in results:
                chunks.append({
                    "content": res_chunk.content,
                    "doc_id": str(res_chunk.document_id),
                    "quarter": quarter
                })
    except Exception as e:
        print(f"[nodes] Failed to retrieve concall chunks: {e}")
    finally:
        db.close()
    return chunks


def run_agent_c_sentiment(state: dict) -> dict:
    ticker = state.get("ticker", "UNKNOWN")
    
    # Fetch live chunks using our pgvector RAG retriever
    chunks = _retrieve_concall_chunks(ticker)
    
    if chunks:
        context_str = "\n\n".join([
            f"--- Chunk from Document ID {c['doc_id']} ({c['quarter']}) ---\n{c['content']}"
            for c in chunks
        ])
        note_str = "Analyze the live concall transcript chunks supplied below to ground your sentiment score, guidance changes, and red flags."
    else:
        context_str = "No live concall transcript data found in database for this ticker."
        note_str = "No live concall data supplied in context. Warn about this in the summary, and evaluate using your general historical knowledge of the company."

    prompt = (
        "You are Agent C, a highly skeptical and investigative management sentiment analyst.\n"
        "Your goal is to parse the supplied earnings call transcripts and evaluate management's candor, optimism, and forward guidance accuracy. "
        "Return STRICT JSON matching the schema.\n\n"
        "Evaluation Instructions:\n"
        "- Guidance Changes: Identify if management has raised, maintained, or lowered their guidance. Look for defensive phrases like 'challenging market conditions' or 'expecting headwinds' to evaluate downward revisions.\n"
        "- Tone Shifts: Search for evasive, defensive, or vague answers during the Q&A segment from analysts (e.g., dodging direct questions about profit margins, market share loss, or project delays).\n"
        "- Red Flags: Call out concrete warning signs: delays in capex completion, margin contraction warnings, auditor issues, customer churn, or high promoter leverage.\n\n"
        "Requirements:\n"
        "1. Write a sharp, critical summary highlighting management confidence levels, tone changes, and guidance realism.\n"
        "2. Collect 1-2 verbatim quotes supporting your evaluation. For each evidence item, set 'source' to the Document ID, and 'pillar' to 'Management Sentiment'.\n\n"
        f"Schema: {_schema_hint(ManagementSentimentOutput)}\n\n"
        f"Stock: {ticker}\n"
        f"Instructions: {note_str}\n\n"
        f"Concall Context Chunks:\n{context_str}"
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
        "You are Agent D, an ultra-precise corporate valuation and risk audit specialist for Indian equities.\n"
        "Your task is to estimate realistic fair values and perform a rigorous balance sheet and governance audit. "
        "Return STRICT JSON matching the schema.\n\n"
        "Valuation Methodology Guidelines:\n"
        "- Calculate target prices (Bear, Base, Bull in INR) using a standard earnings multiple approach, anchored to the stock's current price.\n"
        "- Current price is supplied in the financial data. Your Base Target should represent a reasonable forward multiple based on earnings growth. Bull Target should reflect premium valuation expansion. Bear Target must reflect severe multiple contraction or macro stress.\n"
        "- Ensure Bear < Base < Bull. If current price is ₹100, Base target should be realistic (e.g., ₹115-130 depending on growth) rather than arbitrary extreme values.\n\n"
        "Risk Audit Requirements:\n"
        "- Governance Risks: Evaluate low promoter holdings (<35%) or increasing promoter pledge levels.\n"
        "- Operational Risks: Identify margin contraction by comparing TTM EBITDA margins against historical years.\n"
        "- Balance Sheet Leverage: Identify high Net Debt-to-EBITDA (>3.0x is highly risky, <1.0x is very safe).\n"
        "- Liquidity & Float: Check working capital cash conversion cycles and trading float tightness.\n\n"
        "Populate schema list fields: 'risk_flags', 'accounting_flags', and 'liquidity_flags' with explicit indicators (e.g., 'high_debt_leverage', 'promoter_pledging', etc.).\n\n"
        f"Schema: {_schema_hint(ValuationRiskOutput)}\n\n"
        f"Stock: {ticker}\n"
        f"Financial data: {json.dumps(fin_data, default=str)[:2000]}"
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
        "You are the Lead Synthesis Agent for a premium institutional equity research firm.\n"
        "Your task is to synthesize the individual specialist analyst reports (Fundamentals, Sector, Sentiment, Valuation) into a flawless, cohesive investment thesis paragraph (exactly 120-150 words).\n\n"
        "Writing & Formatting Instructions:\n"
        "1. Write in a highly professional, dense, and objective institutional tone. Do not use fluffy marketing language or generic phrases.\n"
        "2. Synthesize the findings: start with a strong buy/hold/avoid stance, explain the core fundamental driver (revenue growth or profitability efficiency), summarize the sector tailwind or competitive advantage, inject management concall findings (optimistic or cautious guidance), and address valuation targets and major risks.\n"
        "3. Highlight key metrics, scores, sectors, and ticker names by wrapping them in markdown bold tags (**). (e.g., '**MCX**', '**BUY**', '**83.5%**', '**Financial Services**', '**ROIC of 43.2%**'). This is critical for our UI highlights.\n"
        "4. Strict requirement: Return JSON matching the schema.\n\n"
        f"Schema: {_schema_hint(SynthesisOutput)}\n\n"
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
