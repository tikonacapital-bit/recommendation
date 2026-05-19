import os
from urllib.parse import urlparse

from dotenv import load_dotenv

load_dotenv()

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")


try:
    from celery import Celery
except ModuleNotFoundError:
    Celery = None


def create_celery_app():
    if Celery is None:
        return None

    celery_app = Celery(
        "equity_research",
        broker=os.getenv("CELERY_BROKER_URL", REDIS_URL),
        backend=os.getenv("CELERY_RESULT_BACKEND", REDIS_URL),
        include=["app.tasks"],
    )
    celery_app.conf.update(
        task_track_started=True,
        task_serializer="json",
        result_serializer="json",
        accept_content=["json"],
        timezone="Asia/Kolkata",
        enable_utc=True,
        worker_prefetch_multiplier=1,
        task_acks_late=True,
    )
    return celery_app


def broker_status() -> tuple[str, str]:
    if Celery is None:
        return "unavailable", "Celery is not installed."

    broker_url = os.getenv("CELERY_BROKER_URL", REDIS_URL)
    parsed = urlparse(broker_url)
    if parsed.scheme != "redis":
        return "unknown", f"Broker scheme '{parsed.scheme}' is not checked by health probe."

    try:
        import redis

        client = redis.Redis.from_url(broker_url, socket_connect_timeout=1, socket_timeout=1)
        client.ping()
        return "ok", "Redis broker is reachable."
    except Exception as exc:
        return "unavailable", f"Redis broker is not reachable: {exc}"


celery_app = create_celery_app()
