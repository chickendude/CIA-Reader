"""Run queued language-processing jobs using the stores supplied in the worker context."""

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
    """Allow the worker to start without a database store."""
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
    Compose service wraps that in a supervisor with
    restart-on-failure and appropriate log forwarding.
    """

    functions = JOB_FUNCTIONS
    on_startup = on_startup
    on_shutdown = on_shutdown
    redis_settings = redis_settings_from_env()
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
