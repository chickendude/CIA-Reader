"""Tests for :mod:`app.worker.jobs` (T-2.6).

These tests run the real job logic against in-memory fakes — no Redis,
no Postgres. That's deliberate: the wiring to Redis lives in
:mod:`arq.worker.Worker` itself (we have no reason to re-test it), and
the Postgres wiring lands in M4. What changes per-job, and what we
have to cover here, is the sequence of store calls the job makes on
the golden and failure paths.
"""

from __future__ import annotations

import pytest

from app.schemas import Token
from app.worker.jobs import process_text
from app.worker.store import ChapterPayload


class _FakeTextStore:
    def __init__(self, chapters: dict[str, ChapterPayload]) -> None:
        self._chapters = chapters
        self.calls: list[tuple[str, tuple]] = []

    async def load_chapter(self, chapter_id: str) -> ChapterPayload:
        self.calls.append(("load_chapter", (chapter_id,)))
        return self._chapters[chapter_id]

    async def mark_processing(self, text_id: str) -> None:
        self.calls.append(("mark_processing", (text_id,)))

    async def mark_ready(self, text_id: str) -> None:
        self.calls.append(("mark_ready", (text_id,)))

    async def mark_failed(self, text_id: str, error: str) -> None:
        self.calls.append(("mark_failed", (text_id, error)))


class _FakeTokenStore:
    def __init__(self) -> None:
        self.tokens_by_chapter: dict[str, list[Token]] = {}
        self.calls: list[tuple[str, tuple]] = []

    async def write_tokens(self, chapter_id: str, tokens: list[Token]) -> None:
        self.tokens_by_chapter[chapter_id] = list(tokens)
        self.calls.append(("write_tokens", (chapter_id, len(tokens))))

    async def record_job_started(self, *, job_id: str, text_id: str) -> None:
        self.calls.append(("record_job_started", (job_id, text_id)))

    async def record_job_finished(self, *, job_id: str) -> None:
        self.calls.append(("record_job_finished", (job_id,)))

    async def record_job_failed(self, *, job_id: str, error: str) -> None:
        self.calls.append(("record_job_failed", (job_id, error)))


class _ExplodingTextStore(_FakeTextStore):
    async def load_chapter(self, chapter_id: str) -> ChapterPayload:
        self.calls.append(("load_chapter", (chapter_id,)))
        raise RuntimeError("storage unavailable")


def _ctx(text_store, token_store):
    return {
        "job_id": "test-job-1",
        "text_store": text_store,
        "token_store": token_store,
    }


@pytest.mark.asyncio
async def test_process_text_happy_path_marks_processing_then_ready():
    text_store = _FakeTextStore(
        {
            "ch-1": ChapterPayload(chapter_id="ch-1", language="hi", text="नमस्ते दुनिया"),
            "ch-2": ChapterPayload(chapter_id="ch-2", language="hi", text="ठीक है"),
        }
    )
    token_store = _FakeTokenStore()

    result = await process_text(
        _ctx(text_store, token_store),
        text_id="text-1",
        chapter_ids=["ch-1", "ch-2"],
    )

    assert result.text_id == "text-1"
    assert result.chapters_processed == 2
    # 2 tokens in each chapter (whitespace-split fake Stanza from conftest)
    assert result.tokens_written == 4

    # Marker sequence: processing before loading chapters, ready after
    # all are written, job bookkeeping brackets the work.
    sequence = [call[0] for call in text_store.calls]
    assert sequence == [
        "mark_processing",
        "load_chapter",
        "load_chapter",
        "mark_ready",
    ]
    token_sequence = [call[0] for call in token_store.calls]
    assert token_sequence == [
        "record_job_started",
        "write_tokens",
        "write_tokens",
        "record_job_finished",
    ]


@pytest.mark.asyncio
async def test_process_text_writes_tokens_for_each_chapter():
    text_store = _FakeTextStore(
        {
            "ch-1": ChapterPayload(chapter_id="ch-1", language="or", text="ନମସ୍କାର ଦୁନିଆ"),
        }
    )
    token_store = _FakeTokenStore()

    await process_text(
        _ctx(text_store, token_store),
        text_id="text-or",
        chapter_ids=["ch-1"],
    )

    assert "ch-1" in token_store.tokens_by_chapter
    # The real Odia pipeline should produce non-empty tokens for a
    # recognised greeting.
    assert len(token_store.tokens_by_chapter["ch-1"]) == 2


@pytest.mark.asyncio
async def test_process_text_marks_failed_on_store_error_and_reraises():
    text_store = _ExplodingTextStore({})
    token_store = _FakeTokenStore()

    with pytest.raises(RuntimeError, match="storage unavailable"):
        await process_text(
            _ctx(text_store, token_store),
            text_id="text-fail",
            chapter_ids=["ch-1"],
        )

    # Failure bookkeeping must have fired even though we re-raise.
    assert ("mark_failed", ("text-fail", "storage unavailable")) in text_store.calls
    assert any(call[0] == "record_job_failed" for call in token_store.calls)
    # And mark_ready must NOT have fired.
    assert "mark_ready" not in [c[0] for c in text_store.calls]


@pytest.mark.asyncio
async def test_process_text_error_message_is_truncated_to_500_chars():
    text_store = _ExplodingTextStore({})
    text_store.load_chapter = _long_error  # type: ignore[assignment]
    token_store = _FakeTokenStore()

    with pytest.raises(RuntimeError):
        await process_text(
            _ctx(text_store, token_store),
            text_id="t",
            chapter_ids=["c"],
        )

    mark_failed = next(c for c in text_store.calls if c[0] == "mark_failed")
    _, (_, msg) = mark_failed
    assert len(msg) <= 500
    assert msg == "x" * 500


async def _long_error(chapter_id: str) -> ChapterPayload:
    raise RuntimeError("x" * 1000)


@pytest.mark.asyncio
async def test_process_text_requires_text_store_in_ctx():
    with pytest.raises(RuntimeError, match="Worker context missing required store"):
        await process_text(
            {"job_id": "j"},
            text_id="t",
            chapter_ids=["c"],
        )


@pytest.mark.asyncio
async def test_process_text_accepts_unified_store_key():
    # ctx['store'] satisfies both roles when a single DB client
    # implements both protocols — saves wiring noise in production.
    class _Combined(_FakeTextStore, _FakeTokenStore):  # type: ignore[misc]
        def __init__(self, chapters):
            _FakeTextStore.__init__(self, chapters)
            _FakeTokenStore.__init__(self)

    combined = _Combined(
        {
            "ch-1": ChapterPayload(chapter_id="ch-1", language="hi", text="नमस्ते"),
        }
    )
    await process_text(
        {"job_id": "j", "store": combined},
        text_id="t",
        chapter_ids=["ch-1"],
    )
    assert "ch-1" in combined.tokens_by_chapter


@pytest.mark.asyncio
async def test_process_text_dispatches_per_chapter_language():
    # Two chapters in different languages — the dispatcher should run
    # each one through its own pipeline. Smoke against the real cache.
    text_store = _FakeTextStore(
        {
            "hi-ch": ChapterPayload(chapter_id="hi-ch", language="hi", text="एक दो"),
            "or-ch": ChapterPayload(chapter_id="or-ch", language="or", text="ନମସ୍କାର"),
        }
    )
    token_store = _FakeTokenStore()
    await process_text(
        _ctx(text_store, token_store),
        text_id="mixed",
        chapter_ids=["hi-ch", "or-ch"],
    )
    # Both chapters have tokens written — exactly 2 write_tokens calls.
    writes = [c for c in token_store.calls if c[0] == "write_tokens"]
    assert len(writes) == 2
    assert {c[1][0] for c in writes} == {"hi-ch", "or-ch"}
