"""
End-to-end test: Ingest → Prefilter → LangGraph Agent Pipeline → Synthesize
Run:  python test_e2e.py
"""

import json
import os
import sys

# ─────────────────────────── load .env ───────────────────────────────────────
from dotenv import load_dotenv
load_dotenv()

# ─────────────────────────── pretty helpers ──────────────────────────────────
GREEN  = "\033[92m"
YELLOW = "\033[93m"
RED    = "\033[91m"
CYAN   = "\033[96m"
RESET  = "\033[0m"

# Try reconfiguring stdout to utf-8 if supported
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# Detect if console encoding is UTF-8
is_utf8 = False
try:
    if sys.stdout.encoding and sys.stdout.encoding.lower() in ("utf-8", "utf8"):
        is_utf8 = True
except Exception:
    pass

OK_SYM   = "✓" if is_utf8 else "[OK]"
INFO_SYM = "ℹ" if is_utf8 else "[INFO]"
WARN_SYM = "⚠" if is_utf8 else "[WARN]"
FAIL_SYM = "✗" if is_utf8 else "[FAIL]"
LINE_SYM = "─" if is_utf8 else "-"

def ok(msg):   print(f"{GREEN}  {OK_SYM} {msg}{RESET}")
def info(msg): print(f"{CYAN}  {INFO_SYM} {msg}{RESET}")
def warn(msg): print(f"{YELLOW}  {WARN_SYM} {msg}{RESET}")
def fail(msg): print(f"{RED}  {FAIL_SYM} {msg}{RESET}"); sys.exit(1)
def step(msg): print(f"\n{CYAN}{LINE_SYM*55}\n  {msg}\n{LINE_SYM*55}{RESET}")

# ─────────────────────────── TEST CONFIG ─────────────────────────────────────
TEST_TICKERS = ["RELIANCE.NS", "TCS.NS", "INFY.NS"]   # 3 stocks
SKIP_INGEST  = False   # set True to skip yfinance calls when already in DB

# ═════════════════════════════════════════════════════════════════════════════
# 1. DB INIT
# ═════════════════════════════════════════════════════════════════════════════
step("Step 1 — Database initialization")
try:
    from app.core.init_db import init_db
    init_db()
    ok("DB tables created / already exist")
except Exception as e:
    fail(f"DB init failed: {e}")

# ═════════════════════════════════════════════════════════════════════════════
# 2. INGESTION
# ═════════════════════════════════════════════════════════════════════════════
step("Step 2 — Data ingestion via yfinance")
if SKIP_INGEST:
    warn("Skipping ingestion (SKIP_INGEST=True)")
else:
    try:
        from app.services.ingestion import fetch_and_store_stock_data
        fetch_and_store_stock_data(TEST_TICKERS)
        ok(f"Ingested: {TEST_TICKERS}")
    except Exception as e:
        fail(f"Ingestion failed: {e}")

# ═════════════════════════════════════════════════════════════════════════════
# 3. VERIFY STOCKS IN DB
# ═════════════════════════════════════════════════════════════════════════════
step("Step 3 — Verify stocks in DB")
try:
    from app.core.db import SessionLocal
    from app.models.models import Stock, FinancialModel
    db = SessionLocal()
    for t in TEST_TICKERS:
        stock = db.query(Stock).filter(Stock.ticker == t).first()
        if not stock:
            fail(f"Ticker {t} not found in DB after ingestion")
        fm = db.query(FinancialModel).filter(FinancialModel.stock_id == stock.id).first()
        ok(f"{t} → id={stock.id}, sector={stock.sector}, financial_model={'✓' if fm else '✗'}")
except Exception as e:
    fail(f"DB verification error: {e}")

# ═════════════════════════════════════════════════════════════════════════════
# 4. TIER-1 PREFILTER
# ═════════════════════════════════════════════════════════════════════════════
step("Step 4 — Tier-1 Prefilter")
try:
    from app.services.prefilter import run_prefilter
    run = run_prefilter(db, TEST_TICKERS)
    ok(f"Prefilter run_id={run.id}, status={run.status}, processed={run.processed_count}/{run.total_stocks}")
except Exception as e:
    fail(f"Prefilter failed: {e}")

# ═════════════════════════════════════════════════════════════════════════════
# 5. LANGGRAPH AGENT PIPELINE (one stock)
# ═════════════════════════════════════════════════════════════════════════════
step("Step 5 — LangGraph Agent Pipeline")
info("Running against 1 stock to keep API cost low during test…")
try:
    from app.agents.graph import graph
    test_state = {
        "ticker": "TCS.NS",
        "sector": "Technology",
        "technical_score": 65.0,
        "agent_a_output": {},
        "agent_b_output": {},
        "agent_c_output": {},
        "agent_d_output": {},
        "synthesis_output": {},
    }
    final = graph.invoke(test_state)

    # Show agent outputs
    for key in ("agent_a_output", "agent_b_output", "agent_c_output", "agent_d_output"):
        agent_data = final.get(key, {})
        ok(f"{key}: {json.dumps(agent_data, default=str)[:120]}…")

    synthesis = final.get("synthesis_output", {})
    ok(f"Composite score : {synthesis.get('composite_score', 'N/A')}")
    ok(f"Recommendation  : {synthesis.get('recommendation', 'N/A')}")
    ok(f"Thesis (first 120): {str(synthesis.get('thesis_paragraph', ''))[:120]}…")
except Exception as e:
    fail(f"LangGraph pipeline failed: {e}")

# ═════════════════════════════════════════════════════════════════════════════
# 6. FULL SYNTHESIZE VIA API SERVICE (writes back to DB)
# ═════════════════════════════════════════════════════════════════════════════
step("Step 6 — Full synthesize_latest_analysis → DB write-back")
try:
    from app.services.llm_synthesis import synthesize_latest_analysis, LLMConfigError
    analysis = synthesize_latest_analysis(db, "TCS.NS")
    ok(f"Analysis id={analysis.id}")
    ok(f"Composite score: {analysis.composite_score}")
    ok(f"Recommendation : {analysis.recommendation}")
    ok(f"Confidence     : {analysis.confidence_score}")
    ok(f"Thesis (first 120): {str(analysis.thesis_paragraph or '')[:120]}")
except LLMConfigError as e:
    warn(f"LLM not configured (skip): {e}")
except Exception as e:
    fail(f"Synthesis service failed: {e}")
finally:
    db.close()

# ═════════════════════════════════════════════════════════════════════════════
print(f"\n{GREEN}{'═'*55}")
print("  All steps completed successfully! MVP pipeline works.")
print(f"{'═'*55}{RESET}\n")
