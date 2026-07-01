import requests

url = "http://127.0.0.1:8000/stocks/screener-filters"
try:
    response = requests.get(url)
    print(f"Status code: {response.status_code}")
    print(f"Response snippet:\n{response.text[:2000]}")
except Exception as e:
    print(f"Error querying local API: {e}")
