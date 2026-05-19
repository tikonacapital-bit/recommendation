import argparse

from sqlalchemy import text
from sqlalchemy.exc import OperationalError, SQLAlchemyError


def _print_auth_hint(exc: OperationalError) -> None:
    message = str(exc.orig).lower() if getattr(exc, "orig", None) else str(exc).lower()
    if "password authentication failed" in message:
        print("hint=Supabase rejected the database password.")
        print("hint=Use the database password from Project Settings > Database, not the anon/service API key.")
        print("hint=If the password contains @ # % / : ? or spaces, URL-encode it in DATABASE_URL.")
    elif "timeout" in message or "timed out" in message or "could not translate host name" in message:
        print("hint=The direct Supabase DB host may be unreachable from this network, often due to IPv6.")
        print("hint=Use Supabase's Session Pooler connection string on port 6543 for local app access.")


def check_db(debug: bool = False) -> None:
    try:
        from app.core.db import engine
    except ValueError as exc:
        print("connection=not_checked")
        print(f"config_error={exc}")
        if debug:
            raise
        return

    print(engine.url.render_as_string(hide_password=True))
    try:
        with engine.connect() as conn:
            row = conn.execute(
                text("select current_database(), current_user, version();")
            ).first()
            print(f"database={row[0]} user={row[1]}")
            print("connection=ok")
    except OperationalError as exc:
        print("connection=failed")
        print("error=OperationalError")
        _print_auth_hint(exc)
        if debug:
            raise
    except SQLAlchemyError as exc:
        print("connection=failed")
        print(f"error={exc.__class__.__name__}")
        if debug:
            raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--debug", action="store_true", help="show full traceback")
    args = parser.parse_args()
    check_db(debug=args.debug)
