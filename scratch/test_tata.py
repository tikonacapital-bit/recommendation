import requests

urls = [
    "https://www.screener.in/company/TATAMOTORS/consolidated/",
    "https://www.screener.in/company/TATAMOTORS/"
]

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

for url in urls:
    response = requests.get(url, headers=headers)
    print(f"URL: {url} | Status: {response.status_code}")
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(response.text, 'html.parser')
    title = soup.find('title')
    print(f"Title: {title.text if title else 'No title'}")
    print(f"Body snippet:\n{response.text[:800]}")
