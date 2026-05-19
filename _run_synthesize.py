from dotenv import load_dotenv; load_dotenv()
from app.core.db import SessionLocal
from app.services.llm_synthesis import synthesize_latest_analysis

db = SessionLocal()
try:
    print("Running synthesize_latest_analysis for TCS.NS...")
    analysis = synthesize_latest_analysis(db, "TCS.NS")
    print(f"\n=== DB WRITE-BACK RESULT ===")
    print(f"  analysis.id       : {analysis.id}")
    print(f"  composite_score   : {analysis.composite_score}")
    print(f"  recommendation    : {analysis.recommendation}")
    print(f"  confidence_score  : {analysis.confidence_score}")
    print(f"  growth_score      : {analysis.growth_score}")
    print(f"  durability_score  : {analysis.durability_score}")
    print(f"  mgmt_quality_score: {analysis.mgmt_quality_score}")
    print(f"  sector_score      : {analysis.sector_score}")
    print(f"  valuation_score   : {analysis.valuation_score}")
    print(f"  target_prices     : {analysis.target_prices}")
    print(f"  key_risks         : {analysis.key_risks}")
    print(f"  key_catalysts     : {analysis.key_catalysts}")
    print(f"  thesis (150 char) : {str(analysis.thesis_paragraph or '')[:150]}")
    print(f"  agent_outputs keys: {list((analysis.agent_outputs or {}).keys())}")
finally:
    db.close()
