from dotenv import load_dotenv; load_dotenv()
import json

print("--- LangGraph Agent Pipeline (TCS.NS) ---")
from app.agents.graph import graph

state = {
    "ticker": "TCS.NS",
    "sector": "Technology",
    "technical_score": 65.0,
    "agent_a_output": {},
    "agent_b_output": {},
    "agent_c_output": {},
    "agent_d_output": {},
    "synthesis_output": {},
}

print("Invoking graph...")
final = graph.invoke(state)

for key in ("agent_a_output", "agent_b_output", "agent_c_output", "agent_d_output"):
    data = final.get(key, {})
    print(f"{key}: {json.dumps(data, default=str)[:200]}")

synthesis = final.get("synthesis_output", {})
print("\n=== SYNTHESIS ===")
print("  composite_score :", synthesis.get("composite_score"))
print("  recommendation  :", synthesis.get("recommendation"))
print("  confidence_score:", synthesis.get("confidence_score"))
print("  thesis:", str(synthesis.get("thesis_paragraph",""))[:300])
print("  key_risks:", synthesis.get("key_risks"))
print("  key_catalysts:", synthesis.get("key_catalysts"))
print("  target_prices:", synthesis.get("target_prices"))
