"""Workers use these interfaces to read chapters, save analyses and report progress. Tests supply
in-memory stores."""

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
