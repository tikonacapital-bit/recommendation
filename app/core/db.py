import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

load_dotenv()

DEFAULT_DATABASE_URL = "postgresql+psycopg2://postgres:password@localhost:5432/recommendation_os"
DATABASE_URL = os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)


class DatabaseConfigError(ValueError):
    pass


def _normalize_database_url(database_url: str) -> str:
    """Accept common Supabase/Postgres URL variants and return a SQLAlchemy URL."""
    database_url = database_url.strip().strip('"').strip("'")
    if database_url.startswith("DATABASE_URL="):
        database_url = database_url.replace("DATABASE_URL=", "", 1).strip()

    if database_url.startswith("postgres://"):
        database_url = database_url.replace("postgres://", "postgresql+psycopg2://", 1)
    elif database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgresql+psycopg2://", 1)
    return database_url


def _validate_database_url(database_url: str) -> None:
    placeholder_tokens = [
        "YOUR_PASSWORD",
        "[YOUR-PASSWORD]",
        "YOUR_ACTUAL_PASSWORD",
        "YOUR_REAL_DATABASE_PASSWORD",
        "PROJECT_REF",
        "REGION",
    ]
    for token in placeholder_tokens:
        if token in database_url:
            raise DatabaseConfigError(
                f"DATABASE_URL still contains placeholder '{token}'. "
                "Copy the real Supabase Session Pooler connection string from "
                "Project Settings > Database > Connection string."
            )


def _connect_args(database_url: str) -> dict[str, str]:
    url = make_url(database_url)
    query = {key.lower(): value for key, value in url.query.items()}
    if "supabase" in (url.host or "") and "sslmode" not in query:
        return {"sslmode": "require"}
    return {}


DATABASE_URL = _normalize_database_url(DATABASE_URL)
_validate_database_url(DATABASE_URL)
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=300,
    connect_args=_connect_args(DATABASE_URL),
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
