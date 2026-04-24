"""Tests for :mod:`app.worker.overrides` (T-2.7).

Two layers of coverage:

1. :func:`context_signature` — deterministic, stable across the
   aggregation-side writer (T-6.7) and the worker-side reader here.
   If these two ever disagree, overrides silently stop applying; the
   hash is simple enough that pinning the exact format here is the
   cheapest way to guarantee they stay in sync.
2. :func:`apply_overrides` — the swap itself: a hit becomes the new
   top candidate, ``is_oov``/``is_ambiguous`` both clear, the
   original candidates are preserved underneath (so the "alternate
   meanings" UI at T-6.1 can still render them), and non-word /
   punctuation tokens are passed through untouched.

An integration test through :func:`process_text` pins the full wiring
the worker uses in production: Stanza says X, the override store says
Y, we persist Y.
"""

from __future__ import annotations

import pytest

from app.schemas import LemmaCandidate, Token
from app.worker.jobs import process_text
from app.worker.overrides import (
    OverrideHit,
    apply_overrides,
    context_signature,
)
from app.worker.store import ChapterPayload
from tests.test_worker_jobs import _FakeTextStore, _FakeTokenStore


class _FakeOverrideStore:
    def __init__(self, hits: dict[tuple[str, str, str], OverrideHit]) -> None:
        self._hits = hits
        self.calls: list[tuple[str, str, str]] = []

    async def lookup(
        self,
        *,
        language: str,
        surface_nfc: str,
        context_signature: str,
    ) -> OverrideHit | None:
        key = (language, surface_nfc, context_signature)
        self.calls.append(key)
        return self._hits.get(key)


def _word(idx: int, surface: str, lemma: str, pos: str, *, score: float = 0.9) -> Token:
    return Token(
        idx=idx,
        surface=surface,
        is_word=True,
        candidates=[LemmaCandidate(lemma=lemma, pos=pos, score=score)],
        is_ambiguous=False,
        is_oov=False,
    )


def _punct(idx: int, surface: str) -> Token:
    return Token(idx=idx, surface=surface, is_word=False, candidates=[])


# ---- context_signature ----


def test_context_signature_is_deterministic():
    a = context_signature(prev_pos="NOUN", cur_pos="VERB", next_pos="ADP")
    b = context_signature(prev_pos="NOUN", cur_pos="VERB", next_pos="ADP")
    assert a == b


def test_context_signature_distinguishes_contexts():
    a = context_signature(prev_pos="NOUN", cur_pos="VERB", next_pos="ADP")
    b = context_signature(prev_pos="DET", cur_pos="VERB", next_pos="ADP")
    assert a != b


def test_context_signature_handles_boundary_sentinels():
    # None prev/next is valid input; sig stays well-defined.
    sig = context_signature(prev_pos=None, cur_pos="VERB", next_pos=None)
    assert isinstance(sig, str)
    assert len(sig) == 16


def test_context_signature_is_short_and_hex():
    sig = context_signature(prev_pos="NOUN", cur_pos="VERB", next_pos="ADP")
    assert len(sig) == 16
    int(sig, 16)  # must be valid hex


# ---- apply_overrides ----


@pytest.mark.asyncio
async def test_apply_overrides_returns_input_when_store_is_none():
    tokens = [_word(0, "bolta", "bolna", "VERB")]
    out = await apply_overrides(tokens=tokens, language="hi", store=None)
    assert out is tokens


@pytest.mark.asyncio
async def test_apply_overrides_returns_input_when_no_tokens():
    store = _FakeOverrideStore({})
    out = await apply_overrides(tokens=[], language="hi", store=store)
    assert out == []
    # Empty input short-circuits before any store lookups fire.
    assert store.calls == []


@pytest.mark.asyncio
async def test_apply_overrides_miss_returns_unchanged_tokens():
    tokens = [
        _word(0, "राम", "राम", "PROPN"),
        _word(1, "बोलता", "बोलना", "VERB"),
    ]
    store = _FakeOverrideStore({})
    out = await apply_overrides(tokens=tokens, language="hi", store=store)
    assert out == tokens
    # Both word tokens were probed.
    assert len(store.calls) == 2


@pytest.mark.asyncio
async def test_apply_overrides_hit_prepends_override_candidate():
    tokens = [
        _word(0, "राम", "राम", "PROPN"),
        _word(1, "बोलता", "बोलना_wrong", "VERB"),
        _word(2, "है", "है", "AUX"),
    ]
    sig = context_signature(prev_pos="PROPN", cur_pos="VERB", next_pos="AUX")
    store = _FakeOverrideStore(
        {
            ("hi", "बोलता", sig): OverrideHit(
                lemma="बोलना",
                pos="VERB",
                features={"Person": "3", "Number": "Sing"},
            ),
        }
    )
    out = await apply_overrides(tokens=tokens, language="hi", store=store)
    assert len(out) == 3
    hit_tok = out[1]
    assert hit_tok.candidates[0].lemma == "बोलना"
    assert hit_tok.candidates[0].pos == "VERB"
    assert hit_tok.candidates[0].score == 1.0
    assert hit_tok.candidates[0].features == {"Person": "3", "Number": "Sing"}
    # The original Stanza guess is preserved below the promoted override
    # so the alternate-meanings UI (T-6.1) can still surface it.
    assert hit_tok.candidates[1].lemma == "बोलना_wrong"
    assert len(hit_tok.candidates) == 2


@pytest.mark.asyncio
async def test_apply_overrides_clears_oov_and_ambiguous_flags():
    tok = Token(
        idx=0,
        surface="xyz",
        is_word=True,
        candidates=[LemmaCandidate(lemma="xyz", pos="X", score=0.1)],
        is_ambiguous=True,
        is_oov=True,
    )
    sig = context_signature(prev_pos="BOS", cur_pos="X", next_pos="EOS")
    store = _FakeOverrideStore(
        {("hi", "xyz", sig): OverrideHit(lemma="corrected", pos="NOUN", features={})}
    )
    out = await apply_overrides(tokens=[tok], language="hi", store=store)
    assert out[0].is_oov is False
    assert out[0].is_ambiguous is False
    assert out[0].candidates[0].lemma == "corrected"


@pytest.mark.asyncio
async def test_apply_overrides_skips_non_word_tokens():
    tokens = [
        _word(0, "राम", "राम", "PROPN"),
        _punct(1, "।"),
    ]
    store = _FakeOverrideStore({})
    out = await apply_overrides(tokens=tokens, language="hi", store=store)
    assert out[1] is tokens[1]
    # Only the word token was probed.
    assert len(store.calls) == 1
    assert store.calls[0][1] == "राम"


@pytest.mark.asyncio
async def test_apply_overrides_context_uses_surrounding_word_pos_only():
    # Punctuation between two words shouldn't corrupt the signature —
    # the non-word token sits in pos_sequence as None and the helper
    # walks through it to find the next / previous real POS.
    tokens = [
        _word(0, "राम", "राम", "PROPN"),
        _punct(1, ","),
        _word(2, "बोलता", "bolna", "VERB"),
        _punct(3, "।"),
        _word(4, "है", "hona", "AUX"),
    ]
    expected_sig = context_signature(prev_pos="PROPN", cur_pos="VERB", next_pos="AUX")
    store = _FakeOverrideStore({})
    await apply_overrides(tokens=tokens, language="hi", store=store)
    # Three word tokens probed; the middle one used the neighbors'
    # POS tags, not the punctuation it actually sits next to.
    verb_call = next(c for c in store.calls if c[1] == "बोलता")
    assert verb_call[2] == expected_sig


@pytest.mark.asyncio
async def test_apply_overrides_uses_bos_eos_sentinels_at_chapter_edges():
    tokens = [
        _word(0, "राम", "राम", "PROPN"),
        _word(1, "बोलता", "bolna", "VERB"),
    ]
    store = _FakeOverrideStore({})
    await apply_overrides(tokens=tokens, language="hi", store=store)
    # First token's prev sentinel + last token's next sentinel are
    # distinct signatures, regardless of the token's own POS.
    first_sig = store.calls[0][2]
    second_sig = store.calls[1][2]
    assert first_sig == context_signature(
        prev_pos="BOS", cur_pos="PROPN", next_pos="VERB"
    )
    assert second_sig == context_signature(
        prev_pos="PROPN", cur_pos="VERB", next_pos="EOS"
    )


# ---- integration through process_text ----


@pytest.mark.asyncio
async def test_process_text_applies_overrides_before_persisting():
    text_store = _FakeTextStore(
        {"ch-1": ChapterPayload(chapter_id="ch-1", language="hi", text="नमस्ते दुनिया")}
    )
    token_store = _FakeTokenStore()
    # Conftest fake stanza whitespace-splits, so both tokens get
    # PROPN (per the dummy conftest pipeline). Override the second one.
    # Use a permissive matcher: the fake pipeline likely stamps some
    # POS on both tokens, so we compute the signature once we know what
    # it is. Cheapest way: override every call that matches the surface.
    class _SurfaceMatchingStore:
        def __init__(self) -> None:
            self.calls: list[tuple[str, str, str]] = []

        async def lookup(self, *, language, surface_nfc, context_signature):
            self.calls.append((language, surface_nfc, context_signature))
            if surface_nfc == "दुनिया":
                return OverrideHit(lemma="दुनिया_OVERRIDE", pos="NOUN", features={})
            return None

    override_store = _SurfaceMatchingStore()

    await process_text(
        {
            "job_id": "j",
            "text_store": text_store,
            "token_store": token_store,
            "override_store": override_store,
        },
        text_id="t",
        chapter_ids=["ch-1"],
    )

    written = token_store.tokens_by_chapter["ch-1"]
    target = next(t for t in written if t.surface == "दुनिया")
    assert target.candidates[0].lemma == "दुनिया_OVERRIDE"


@pytest.mark.asyncio
async def test_process_text_skips_overrides_when_store_missing():
    # The MVP default pre-T-6.7 — no override store in ctx — still
    # processes successfully. This is how jobs run on day one.
    text_store = _FakeTextStore(
        {"ch-1": ChapterPayload(chapter_id="ch-1", language="hi", text="नमस्ते")}
    )
    token_store = _FakeTokenStore()
    await process_text(
        {"job_id": "j", "text_store": text_store, "token_store": token_store},
        text_id="t",
        chapter_ids=["ch-1"],
    )
    assert "ch-1" in token_store.tokens_by_chapter
