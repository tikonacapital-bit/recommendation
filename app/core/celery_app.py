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
        # Performance & stability tunings
        task_time_limit=180,           # Hard timeout: kill task after 3 minutes
        task_soft_time_limit=150,      # Soft timeout: raise SoftTimeLimitExceeded after 2.5 minutes
        worker_max_tasks_per_child=50, # Recycle worker child processes after 50 tasks to clear memory leaks
        broker_connection_retry_on_startup=True,
        task_publish_retry=True,
        result_expires=1800,           # Keep results in Redis for 30 minutes to prevent memory bloating
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
