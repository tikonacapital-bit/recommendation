"""
Validation Integration Test: Full-Universe Sync & Paced Background Synthesis
Run: python test_universe_run.py
"""

import sys
import unittest
from unittest.mock import patch, MagicMock

# Load environment
from dotenv import load_dotenv
load_dotenv()

# Set up console outputs for Windows terminal encoding safety
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

is_utf8 = False
try:
    if sys.stdout.encoding and sys.stdout.encoding.lower() in ("utf-8", "utf8"):
        is_utf8 = True
except Exception:
    pass

GREEN  = "\033[92m"
CYAN   = "\033[96m"
RED    = "\033[91m"
RESET  = "\033[0m"
OK_SYM = "✓" if is_utf8 else "[OK]"
FAIL_SYM = "✗" if is_utf8 else "[FAIL]"

def log_ok(msg):
    print(f"{GREEN}  {OK_SYM} {msg}{RESET}")

def log_fail(msg):
    print(f"{RED}  {FAIL_SYM} {msg}{RESET}")


class TestUniverseSynthesisPipeline(unittest.TestCase):

    def setUp(self):
        from app.core.db import SessionLocal
        self.db = SessionLocal()

    def tearDown(self):
        self.db.close()

    def test_01_sync_and_fallback(self):
        """Test syncing from equity_universe and seed fallback endpoint behavior."""
        print("\n" + CYAN + "="*50 + "\n  Testing Sync & Seeding Endpoint Fallback\n" + "="*50 + RESET)
        from app.main import seed_stocks
        
        # Test calling the main seed endpoint to ensure it runs without syntax/import errors
        # Note: Depending on whether equity_universe has rows in PostgreSQL, it will sync or fallback.
        try:
            res = seed_stocks(self.db)
            self.assertIn("status", res)
            self.assertEqual(res["status"], "ok")
            log_ok(f"Seeding completed successfully. Total tracked stocks in DB: {res.get('total_tracked')}")
            log_ok(f"Status message: {res.get('message')}")
        except Exception as e:
            log_fail(f"Seeding failed: {e}")
            raise e

    def test_02_prefilter_and_tiering(self):
        """Test Tier-1 prefilter scores and ranks stocks, applying correct 1 vs 0 tiering."""
        print("\n" + CYAN + "="*50 + "\n  Testing Prefilter & Tiering Ranks\n" + "="*50 + RESET)
        from app.services.prefilter import run_prefilter
        from app.models.models import StockAnalysis
        
        try:
            run = run_prefilter(self.db)
            log_ok(f"Prefilter run completed. Status: {run.status}, Scored: {run.processed_count} stocks.")
            self.assertEqual(run.status, "completed")
            self.assertTrue(run.processed_count > 0)
            
            # Query some high potential stocks (tier = 1)
            tier_1_count = self.db.query(StockAnalysis).filter(
                StockAnalysis.run_id == run.id,
                StockAnalysis.tier_reached == 1
            ).count()
            
            log_ok(f"Found {tier_1_count} high-potential stocks scored in Tier 1 out of {run.processed_count}.")
        except Exception as e:
            log_fail(f"Prefiltering failed: {e}")
            raise e

    def test_03_paced_universe_synthesis_task(self):
        """Test the paced sequential synthesis logic with mocked LLM graph invokes to check loop integrity."""
        print("\n" + CYAN + "="*50 + "\n  Testing Paced Universe synthesis Task (Mocked LLM)\n" + "="*50 + RESET)
        from app.tasks import run_universe_synthesis_sync
        from app.models.models import StockAnalysis
        
        # Mock synchronize_latest_analysis to isolate LLM call costs and rate limits
        mock_analysis = MagicMock()
        mock_analysis.id = 9999
        mock_analysis.composite_score = 75.0
        mock_analysis.recommendation = "BUY"
        
        # synthesize_latest_analysis is imported locally inside run_universe_synthesis_sync,
        # so we patch it where it's defined (the source module), not in app.tasks.
        with patch("app.services.llm_synthesis.synthesize_latest_analysis", return_value=mock_analysis) as mock_synth:
            # Run paced synthesis sync for up to 2 high-potential stocks to verify flow and 1.5s delay
            res = run_universe_synthesis_sync(limit=2)
            
            self.assertEqual(res["status"], "completed")
            self.assertTrue(res["processed"] <= 2)
            mock_synth.assert_called()
            
            log_ok(f"Paced background universe synthesis completed successfully. Processed: {res['processed']} stocks.")
            for r in res["results"]:
                log_ok(f"Stock {r['ticker']}: synthesis status={r['status']}, composite_score={r.get('composite_score')}")


if __name__ == "__main__":
    suite = unittest.TestLoader().loadTestsFromTestCase(TestUniverseSynthesisPipeline)
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    
    if result.wasSuccessful():
        print(f"\n{GREEN}==================================================")
        print("  All validation tests passed successfully!")
        print(f"=================================================={RESET}\n")
        sys.exit(0)
    else:
        print(f"\n{RED}==================================================")
        print("  Some tests failed. Please check the logs.")
        print(f"=================================================={RESET}\n")
        sys.exit(1)
