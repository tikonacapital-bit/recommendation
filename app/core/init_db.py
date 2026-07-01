import logging
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy import text
from app.models.models import Base

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def init_db():
    logger.info("Initializing database...")

    try:
        from app.core.db import engine

        with engine.connect() as conn:
            logger.info("Checking database connection...")
            conn.execute(text("SELECT 1;"))

            # Enable pgvector extension which is required before creating DocumentChunk.
            logger.info("Enabling pgvector extension...")
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector;"))
            conn.commit()

        logger.info("Creating tables...")
        Base.metadata.create_all(bind=engine)

        # create_all() does not mutate existing tables, so keep these additive changes
        # idempotent while the project is still pre-Alembic.
        logger.info("Applying additive schema updates...")
        additive_statements = [
            "ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS run_type VARCHAR(50) DEFAULT 'prefilter';",
            "ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS error_message TEXT;",
            "ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE;",
            "ALTER TABLE stock_analysis ADD COLUMN IF NOT EXISTS sector_score DOUBLE PRECISION;",
            "ALTER TABLE stock_analysis ADD COLUMN IF NOT EXISTS agent_outputs JSON;",
            "ALTER TABLE stock_analysis ADD COLUMN IF NOT EXISTS recommendation VARCHAR(20);",
            "ALTER TABLE stocks ADD COLUMN IF NOT EXISTS broad_sector VARCHAR(255);",
            "ALTER TABLE stocks ADD COLUMN IF NOT EXISTS screener_sector VARCHAR(255);",
            "ALTER TABLE stocks ADD COLUMN IF NOT EXISTS broad_industry VARCHAR(255);",
            "ALTER TABLE stocks ADD COLUMN IF NOT EXISTS industry VARCHAR(255);",
            "ALTER TABLE stocks ADD COLUMN IF NOT EXISTS benchmarks JSON;",
        ]
        with engine.connect() as conn:
            for statement in additive_statements:
                conn.execute(text(statement))
            conn.commit()
    except OperationalError as exc:
        logger.error(
            "Could not connect to the database. For Supabase, verify DATABASE_URL, "
            "password URL-encoding, pooler host/port, and sslmode=require."
        )
        raise exc
    except ProgrammingError as exc:
        logger.error(
            "Database initialization failed while applying SQL. In Supabase, confirm "
            "the vector extension is enabled or that this user can create extensions."
        )
        raise exc
    except ValueError as exc:
        logger.error(str(exc))
        raise SystemExit(1) from exc

    logger.info("Database initialization completed successfully.")

if __name__ == "__main__":
    init_db()
