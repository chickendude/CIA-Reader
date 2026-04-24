"""Async job queue for offline NLP work (T-2.6).

SvelteKit enqueues jobs — text upload, bulk re-processing (T-6.8),
correction aggregation (T-6.7), and eventually Whisper alignment
(M16) — into Redis. A Python ``arq`` worker in this module dequeues
and runs them, writing the results back to Postgres.

The worker is intentionally kept separate from the ``/process``
HTTP endpoint: the latter is synchronous and serves the tap-to-translate
pop-up (millisecond latency); the worker handles multi-second jobs
(loading a 600MB Stanza model, tokenizing a full EPUB chapter,
cross-referencing form_lemma_overrides). Keeping them in separate
processes means one slow Stanza load can't wedge the request path,
and we can scale the two independently on Hetzner.

This module only owns the queue machinery and the job dispatch. The
actual job implementations live in :mod:`app.worker.jobs`; the I/O
boundary (text fetching, token persistence, status flipping) lives in
:mod:`app.worker.store` as protocols the jobs depend on. That split
means the job logic is unit-testable without a real Redis or Postgres,
and M4 can wire real implementations without touching the job
functions themselves.
"""

from __future__ import annotations

import os
from typing import Any

from arq.connections import RedisSettings

from .jobs import JOB_FUNCTIONS, process_text


def redis_settings_from_env() -> RedisSettings:
    """Build :class:`RedisSettings` from the NLP service's env vars.

    Defaults match the Compose network: ``redis://redis:6379/0``. In
    local dev (outside Compose) ``REDIS_URL`` overrides the host.
    """
    url = os.environ.get("REDIS_URL")
    if url:
        return RedisSettings.from_dsn(url)
    return RedisSettings(
        host=os.environ.get("REDIS_HOST", "redis"),
        port=int(os.environ.get("REDIS_PORT", "6379")),
        database=int(os.environ.get("REDIS_DB", "0")),
        password=os.environ.get("REDIS_PASSWORD") or None,
    )


async def on_startup(ctx: dict[str, Any]) -> None:
    """Arq ``on_startup`` hook — runs once per worker process.

    The production wiring (M4) attaches a Postgres connection pool and
    a TextStore / TokenStore implementation to ``ctx`` here so the
    job functions can reach them via their context argument.
    """
    # Populated by M4; kept as a no-op now so the worker boots in CI
    # without a Postgres dependency.
    ctx.setdefault("store", None)


async def on_shutdown(ctx: dict[str, Any]) -> None:
    # Symmetric with on_startup — real implementations close DB pools
    # here so arq's SIGTERM path doesn't leave connections dangling.
    store = ctx.get("store")
    if store is not None and hasattr(store, "aclose"):
        await store.aclose()


class WorkerSettings:
    """Arq worker entry point.

    Run via ``python -m arq app.worker.WorkerSettings``. The Docker
    Compose service (M4 / M13) wraps that in a supervisor with
    restart-on-failure and appropriate log forwarding.
    """

    functions = JOB_FUNCTIONS
    on_startup = on_startup
    on_shutdown = on_shutdown
    redis_settings = redis_settings_from_env()
    # Keep ``max_jobs`` low for the MVP node — a single Stanza model
    # pins ~600MB RAM, and the box has 4 GB usable. Future scaling
    # tunable via WORKER_MAX_JOBS.
    max_jobs = int(os.environ.get("WORKER_MAX_JOBS", "2"))
    # Long per-job timeout because tokenizing a 200-page EPUB chapter
    # can legitimately run 30-60s end-to-end. Reports > 10 min mean
    # something is stuck; arq kills the job.
    job_timeout = int(os.environ.get("WORKER_JOB_TIMEOUT_SEC", "600"))


__all__ = [
    "JOB_FUNCTIONS",
    "WorkerSettings",
    "on_shutdown",
    "on_startup",
    "process_text",
    "redis_settings_from_env",
]
