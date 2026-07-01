from app.core.db import SessionLocal
from app.models.models import Stock
from sqlalchemy import cast, text
from sqlalchemy.dialects.postgresql import JSONB

db = SessionLocal()
try:
    # Check a stock we know has Nifty 50
    stocks = db.query(Stock).filter(Stock.benchmarks.isnot(None)).limit(5).all()
    for s in stocks:
        print(f"{s.ticker}: type={type(s.benchmarks)}, val={s.benchmarks[:3] if s.benchmarks else None}")

    print("\n--- Testing JSON contains query ---")
    # Try raw SQL to confirm the query works
    result = db.execute(text(
        "SELECT ticker, benchmarks FROM stocks WHERE benchmarks::jsonb @> '[\"Nifty 50\"]'::jsonb LIMIT 5"
    )).fetchall()
    print(f"Raw SQL Nifty 50 matches: {len(result)}")
    for row in result:
        print(f"  {row[0]}")

    # Check what values are in the first 3 benchmarks lists
    result2 = db.execute(text(
        "SELECT ticker, benchmarks FROM stocks WHERE benchmarks IS NOT NULL LIMIT 3"
    )).fetchall()
    print("\nSample raw benchmarks:")
    for row in result2:
        print(f"  {row[0]}: {row[1][:3] if row[1] else None}")
finally:
    db.close()
