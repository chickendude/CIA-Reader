"""Job functions executed by the arq worker (T-2.6).

Currently one job: :func:`process_text`. It takes a ``text_id`` and
the ids of its chapters, loads each chapter's raw text, runs the
per-language pipeline, and writes tokens back via the injected store.

The worker context carries the wiring (``store`` for text + token I/O,
``text_store`` / ``token_store`` separately when they come from
different backends). Jobs never touch Redis directly — arq handles
queue plumbing — and they never import a DB client; that's an
intentional seam so the jobs remain testable against in-memory
fakes (see :mod:`tests.test_worker_jobs`).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from app.pipelines import get_pipeline

from .store import TextStore, TokenStore


@dataclass(frozen=True, slots=True)
class ProcessTextResult:
    text_id: str
    chapters_processed: int
    tokens_written: int


def _store(ctx: dict[str, Any], key: str) -> Any:
    store = ctx.get(key) or ctx.get("store")
    if store is None:
        raise RuntimeError(
            f"Worker context missing required store; expected ctx[{key!r}] "
            f"or ctx['store'] to be attached by on_startup."
        )
    return store


async def process_text(
    ctx: dict[str, Any],
    *,
    text_id: str,
    chapter_ids: Sequence[str],
) -> ProcessTextResult:
    """Tokenize and persist a text's chapters.

    The flow mirrors the plan: mark the text as processing, loop over
    each chapter running its language's pipeline, write the resulting
    tokens, then mark ready. Any exception flips the text to ``failed``
    with a truncated error message, and arq's own retry / DLQ machinery
    logs the traceback for on-call investigation.

    The per-chapter loop does **not** parallelize — Stanza models are
    not thread-safe and a single model instance is pinned per
    pipeline_id in the process-wide cache. Running chapters
    sequentially against the same cached model is both correct and
    memory-cheap.
    """
    text_store: TextStore = _store(ctx, "text_store")
    token_store: TokenStore = _store(ctx, "token_store")
    job_id: str = ctx.get("job_id", "unknown-job")

    await token_store.record_job_started(job_id=job_id, text_id=text_id)
    await text_store.mark_processing(text_id)

    try:
        tokens_written = 0
        for chapter_id in chapter_ids:
            payload = await text_store.load_chapter(chapter_id)
            pipeline = get_pipeline(payload.language)
            result = pipeline.process(payload.text)
            await token_store.write_tokens(chapter_id, result.tokens)
            tokens_written += len(result.tokens)

        await text_store.mark_ready(text_id)
        await token_store.record_job_finished(job_id=job_id)
    except Exception as exc:
        # Truncate the message so a Stanza stacktrace doesn't blow out
        # the DB column — the full traceback is in the worker log.
        message = str(exc)[:500] or type(exc).__name__
        await text_store.mark_failed(text_id, message)
        await token_store.record_job_failed(job_id=job_id, error=message)
        raise

    return ProcessTextResult(
        text_id=text_id,
        chapters_processed=len(chapter_ids),
        tokens_written=tokens_written,
    )


JOB_FUNCTIONS = [process_text]


__all__ = ["JOB_FUNCTIONS", "ProcessTextResult", "process_text"]
