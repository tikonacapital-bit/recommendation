import logging
import time
import requests
from bs4 import BeautifulSoup
from sqlalchemy.orm import Session
from app.models.models import Stock

logger = logging.getLogger(__name__)

def robust_get_request(url: str, headers: dict, timeout: int = 15, max_retries: int = 3) -> requests.Response | None:
    """
    Makes a GET request with automatic exponential backoff retry on HTTP 429 (Rate Limited).
    """
    backoff = 10  # Start with a 10s sleep on rate limit
    for attempt in range(max_retries):
        try:
            res = requests.get(url, headers=headers, timeout=timeout)
            if res.status_code == 429:
                logger.warning(f"Rate limited (429) for URL {url}. Attempt {attempt+1}/{max_retries}. Backing off for {backoff}s...")
                time.sleep(backoff)
                backoff *= 2
                continue
            return res
        except Exception as e:
            logger.warning(f"Request exception for URL {url} (Attempt {attempt+1}/{max_retries}): {e}")
            time.sleep(2)
            
    # Final retry try-catch
    try:
        return requests.get(url, headers=headers, timeout=timeout)
    except Exception:
        return None

def resolve_screener_url_path(symbol: str, name: str | None = None) -> str | None:
    """
    Tries to find the correct Screener URL path for a given stock symbol.
    Uses direct testing and falls back to Screener search API with heuristic query splits.
    """
    symbol_upper = symbol.upper()
    if not (symbol_upper.endswith(".NS") or symbol_upper.endswith(".BO")):
        logger.info(f"Skipping non-Indian stock: {symbol}")
        return None

    clean_symbol = symbol.split('.')[0].upper()
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    # 1. Test direct URL (consolidated)
    direct_url = f"https://www.screener.in/company/{clean_symbol}/consolidated/"
    res = robust_get_request(direct_url, headers=headers)
    if res and res.status_code == 200:
        return f"/company/{clean_symbol}/consolidated/"

    # 2. Test direct URL (standalone fallback)
    standalone_url = f"https://www.screener.in/company/{clean_symbol}/"
    res = robust_get_request(standalone_url, headers=headers)
    if res and res.status_code == 200:
        return f"/company/{clean_symbol}/"

    # 3. Apply search API heuristics
    queries = []
    
    # Clean the name of standard corporate suffixes
    if name and name.upper() != symbol.upper() and name.upper() != clean_symbol:
        clean_name = name.replace("Limited", "").replace("Ltd", "").replace(".", "").replace(",", "").strip()
        queries.append(clean_name)
        
    # Split common corporate group prefixes
    groups = ["TATA", "ADANI", "BAJAJ", "HDFC", "ICICI", "KOTAK", "AXIS", "JSW", "HERO", "APOLLO", "COAL", "TUBE"]
    for group in groups:
        if clean_symbol.startswith(group) and len(clean_symbol) > len(group):
            queries.append(f"{group} {clean_symbol[len(group):]}")
            
    # Split common corporate suffixes
    suffixes = ["BANK", "MOTOR", "MOTORS", "STEEL", "POWER", "CHEM", "CONSUM", "PHARMA", "LAB", "DRREDDY", "FINANCE", "FINSV", "PORTS", "LIFE"]
    for suffix in suffixes:
        if clean_symbol.endswith(suffix) and len(clean_symbol) > len(suffix):
            queries.append(f"{clean_symbol[:-len(suffix)]} {suffix}")
            
    # Split internal keywords
    if "BANK" in clean_symbol and not clean_symbol.endswith("BANK"):
        queries.append(clean_symbol.replace("BANK", " BANK "))
        
    # Standard clean symbol fallback
    queries.append(clean_symbol)
    
    # Deduplicate queries while keeping order
    seen = set()
    deduped_queries = []
    for q in queries:
        q_clean = q.replace("-", " ").replace("_", " ").strip()
        if q_clean.lower() not in seen:
            seen.add(q_clean.lower())
            deduped_queries.append(q_clean)
            
    # Query Screener API with search terms
    for q in deduped_queries:
        search_url = f"https://www.screener.in/api/company/search/?q={q}"
        search_res = robust_get_request(search_url, headers=headers)
        if search_res and search_res.status_code == 200:
            try:
                results = search_res.json()
                if results and len(results) > 0:
                    url_path = results[0].get("url")
                    if url_path:
                        logger.info(f"Resolved symbol {symbol} via search query '{q}' to path: {url_path}")
                        return url_path
            except Exception as e:
                logger.warning(f"Error parsing search results JSON for query '{q}': {e}")
            
    return None

def scrape_screener_data(symbol: str, name: str | None = None) -> dict | None:
    """
    Resolve the correct URL and scrape classification and benchmarks from screener.in.
    """
    path = resolve_screener_url_path(symbol, name)
    if not path:
        logger.warning(f"Could not resolve Screener URL path for symbol: {symbol}")
        return None
        
    url = f"https://www.screener.in{path}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    response = robust_get_request(url, headers=headers)
    if not response or response.status_code != 200:
        logger.warning(f"Failed to fetch {url}. Status: {response.status_code if response else 'No Response'}")
        return None

    try:
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # Locate peers section
        peers_section = soup.find('section', id='peers')
        if not peers_section:
            peers_h3 = soup.find(lambda tag: tag.name in ('h2', 'h3') and 'peer comparison' in tag.text.lower())
            if peers_h3:
                peers_section = peers_h3.find_parent('section')

        if not peers_section:
            logger.warning(f"Peers section not found for resolved url: {url}")
            return None

        result = {
            "broad_sector": None,
            "screener_sector": None,
            "broad_industry": None,
            "industry": None,
            "benchmarks": []
        }

        # 1. Parse breadcrumbs (under p class="sub" in peers section)
        sub_p = peers_section.find('p', class_='sub')
        if sub_p:
            links = sub_p.find_all('a')
            for link in links:
                title = link.get('title', '')
                text = link.text.strip()
                if "Broad Sector" in title:
                    result["broad_sector"] = text
                elif "Sector" in title:
                    result["screener_sector"] = text
                elif "Broad Industry" in title:
                    result["broad_industry"] = text
                elif "Industry" in title:
                    result["industry"] = text

        # 2. Parse benchmarks
        benchmarks_p = peers_section.find('p', id='benchmarks')
        if benchmarks_p:
            tags = benchmarks_p.find_all('a')
            result["benchmarks"] = [t.text.strip() for t in tags if t.text.strip()]

        logger.info(f"Successfully scraped screener data for {symbol}: {result}")
        return result

    except Exception as e:
        logger.error(f"Error scraping screener data for {symbol}: {e}", exc_info=True)
        return None


def update_screener_data_for_stock(db: Session, stock_id: int) -> bool:
    """
    Scrape screener data and save it to the database for a single stock.
    """
    stock = db.query(Stock).filter(Stock.id == stock_id).first()
    if not stock:
        logger.warning(f"Stock with ID {stock_id} not found in database.")
        return False

    data = scrape_screener_data(stock.ticker, stock.name)
    if not data:
        return False

    try:
        stock.broad_sector = data.get("broad_sector")
        stock.screener_sector = data.get("screener_sector")
        stock.broad_industry = data.get("broad_industry")
        stock.industry = data.get("industry")
        stock.benchmarks = data.get("benchmarks")
        
        db.commit()
        db.refresh(stock)
        return True
    except Exception as e:
        logger.error(f"Failed to update stock {stock.ticker} screener data in DB: {e}")
        db.rollback()
        return False


def scrape_all_stocks_screener_data(db: Session) -> dict:
    """
    Iterate through stocks that don't have classifications and scrape/update their screener data.
    """
    # Only scrape active stocks that do not have classifications populated yet
    stocks = db.query(Stock).filter(
        Stock.is_active.is_(True),
        (Stock.broad_sector.is_(None)) | (Stock.industry.is_(None))
    ).all()
    
    total = len(stocks)
    success_count = 0
    fail_count = 0
    
    logger.info(f"Starting optimized batch screener scrape for {total} stocks missing classification data...")
    if total == 0:
        return {
            "total": 0,
            "success": 0,
            "failed": 0,
            "message": "All active stocks already have classifications populated."
        }
    
    for idx, stock in enumerate(stocks):
        logger.info(f"[{idx+1}/{total}] Processing {stock.ticker}...")
        success = update_screener_data_for_stock(db, stock.id)
        if success:
            success_count += 1
        else:
            fail_count += 1
        
        # Paced delay to prevent IP blocking
        time.sleep(2.0)
        
    return {
        "total": total,
        "success": success_count,
        "failed": fail_count
    }
