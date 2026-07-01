import requests

tests = [
    "Nifty 50",
    "Nifty 500",
    "BSE Sensex",
    "Nifty Bank",
    "Nifty IT",
]

for idx in tests:
    from urllib.parse import quote
    r = requests.get(f'http://127.0.0.1:8000/top?limit=500&benchmark={quote(idx)}')
    d = r.json()
    print(f"  {idx:35s}  -> {d['count']} stocks")
