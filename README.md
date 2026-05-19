# Multi-Agent Equity Research System

## Supabase Setup

1. Create a Supabase project.
2. In the Supabase SQL editor, run `supabase_setup.sql`.
3. Copy `.env.example` to `.env`.
4. Replace `DATABASE_URL` with your Supabase Session Pooler URL.

Use the pooler URL for the app. Copy the exact Session Pooler / Shared Pooler
string from Supabase, including its real host and port:

```env
DATABASE_URL=postgresql+psycopg2://postgres.PROJECT_REF:YOUR_PASSWORD@REAL_POOLER_HOST:REAL_POOLER_PORT/postgres?sslmode=require
```

If your password contains special characters, URL-encode it before pasting it into `DATABASE_URL`.

Then initialize the tables:

```powershell
python -m app.core.init_db
```

Run the API:

```powershell
python -m uvicorn app.main:app --reload
```

Useful endpoints:

- `GET /health`
- `POST /refresh/{ticker}`
- `POST /prefilter/run`
- `POST /prefilter/run?async_task=true`
- `GET /tasks/{task_id}`
- `GET /worker/health`
- `GET /top`
- `GET /view/{ticker}`

## Worker

Install dependencies, then run Redis and a Celery worker:

```powershell
pip install -r requirements.txt
celery -A app.core.celery_app.celery_app worker --loglevel=info --pool=solo
```

On Windows, `--pool=solo` avoids multiprocessing issues during local development.

If the worker logs `Cannot connect to redis://localhost:6379/0`, Redis is not
running. Start Redis locally or set `REDIS_URL`, `CELERY_BROKER_URL`, and
`CELERY_RESULT_BACKEND` to a reachable Redis service.
