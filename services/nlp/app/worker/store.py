"""Store protocols for worker jobs (T-2.6).

Jobs operate on three I/O abstractions:

* :class:`TextStore` — fetches the raw text of a chapter by id, and
  flips the parent ``texts.status`` column through pending →
  processing → ready / failed.
* :class:`TokenStore` — persists the tokenized output (one row per
  token) and records the per-job ``nlp_jobs`` bookkeeping.
* :class:`JobEvents` — optional callback hook so the web UI's
  processing-status UX (M4) can receive progress events via SSE.

Keeping these as ``Protocol`` classes (instead of concrete Postgres
implementations) means:

1. Unit tests wire in-memory fakes without spinning up a DB — so
   ``test_worker_jobs`` can run in CI against the same logic that
   production exercises.
2. M4 can slot in real Drizzle-backed implementations without
   touching any job code.
3. Future storage swaps (e.g. a read-through cache for bulk reprocess
   in T-6.8) don't require re-writing the jobs.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from app.schemas import Token


@dataclass(frozen=True, slots=True)
class ChapterPayload:
    """Payload returned by :meth:`TextStore.load_chapter`."""

    chapter_id: str
    language: str
    text: str


class TextStore(Protocol):
    async def load_chapter(self, chapter_id: str) -> ChapterPayload: ...

    async def mark_processing(self, text_id: str) -> None: ...

    async def mark_ready(self, text_id: str) -> None: ...

    async def mark_failed(self, text_id: str, error: str) -> None: ...


class TokenStore(Protocol):
    async def write_tokens(
        self, chapter_id: str, tokens: list[Token]
    ) -> None: ...

    async def record_job_started(self, job_id: str, text_id: str) -> None: ...

    async def record_job_finished(self, job_id: str) -> None: ...

    async def record_job_failed(self, job_id: str, error: str) -> None: ...


__all__ = ["ChapterPayload", "TextStore", "TokenStore"]
