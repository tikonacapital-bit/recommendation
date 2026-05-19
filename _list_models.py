from dotenv import load_dotenv; load_dotenv()
import requests, os, json

key = os.getenv("OPENROUTER_API_KEY")
r = requests.get("https://openrouter.ai/api/v1/models", headers={"Authorization": f"Bearer {key}"}, timeout=15)
models = r.json().get("data", [])
free = [m for m in models if ":free" in m.get("id","")]
print(f"Free models available: {len(free)}")
for m in free[:25]:
    print(f"  {m['id']}  ctx={m.get('context_length','?')}")
