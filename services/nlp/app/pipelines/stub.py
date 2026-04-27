"""Canned pipeline used until the real per-language pipelines land.

Splits the input into ALTERNATING word and whitespace / punctuation
runs and emits a :class:`Token` per run, preserving the original
layout: word tokens get one top-K candidate (lemma = surface, OOV
= True), and the runs in between (whitespace, punctuation) become
non-word tokens whose surface is the literal text. The reader renders
non-word tokens as plain text, so spaces + paragraph breaks survive.

Word tokens carry an ISO-15919 romanization computed via
:mod:`app.romanize`, so the reader's "Show romanization" toggle has
something to display even before real Stanza models are wired up.

Kept separate from :mod:`app.main` so that T-2.2 / T-2.3 / T-2.3a can
plug real Stanza / IndicNLP models in by swapping the registry entry in
:mod:`app.pipelines.__init__` — no changes to the HTTP layer.
"""

from __future__ import annotations

import unicodedata

from app.romanize import UnsupportedScriptError, to_roman
from app.schemas import LemmaCandidate, Token

from .base import Pipeline, PipelineResult


def _is_word_char(ch: str) -> bool:
    """A character belongs to a word run iff it's a letter, digit, mark
    (Mn / Mc / Me — Indic vowel signs live here; without them
    Devanagari + Odia words would shred into single-codepoint
    fragments) or an ASCII underscore."""
    if ch == "_":
        return True
    cat = unicodedata.category(ch)
    return cat[0] in ("L", "N", "M")


class StubPipeline(Pipeline):
    """Whitespace-split, surface-as-lemma, everything OOV.

    Preserves the original whitespace + punctuation as non-word tokens
    so the reader can render the original layout faithfully. When
    the registry hands us a script + scheme (the per-language stubs
    in :mod:`app.pipelines` do), every word token also carries a
    romanization via :func:`app.romanize.to_roman`. A bare
    ``StubPipeline()`` (no args) skips romanization, matching the
    original test fixtures.
    """

    pipeline_id = "stub"

    def __init__(
        self,
        *,
        script: str | None = None,
        roman_scheme: str | None = None,
    ) -> None:
        self._script = script
        self._roman_scheme = roman_scheme

    def process(self, text: str) -> PipelineResult:
        if not text:
            return PipelineResult(pipeline_id=self.pipeline_id, tokens=[])

        # Walk the input one character at a time and accumulate runs of
        # the same kind (word vs non-word). Each run becomes a single
        # token. NFC normalisation is the caller's job (happens in
        # /process before dispatch).
        tokens: list[Token] = []
        idx = 0
        run_start = 0
        run_is_word = _is_word_char(text[0])
        for i in range(1, len(text)):
            ch_is_word = _is_word_char(text[i])
            if ch_is_word != run_is_word:
                tokens.append(
                    self._make_token(idx, text[run_start:i], run_is_word),
                )
                idx += 1
                run_start = i
                run_is_word = ch_is_word
        # Trailing run.
        tokens.append(self._make_token(idx, text[run_start:], run_is_word))
        return PipelineResult(pipeline_id=self.pipeline_id, tokens=tokens)

    def _romanize(self, surface: str) -> str | None:
        if not self._script or not self._roman_scheme:
            return None
        try:
            return to_roman(
                surface,
                from_script=self._script,
                to_scheme=self._roman_scheme,
            )
        except UnsupportedScriptError:
            # The registry passed a script we don't yet have a
            # romanizer entry for. Better to skip than to 500.
            return None

    def _make_token(self, idx: int, surface: str, is_word: bool) -> Token:
        if is_word:
            return Token(
                idx=idx,
                surface=surface,
                is_word=True,
                candidates=[
                    LemmaCandidate(lemma=surface, pos="X", score=1.0, features={}),
                ],
                is_ambiguous=False,
                is_oov=True,
                romanization=self._romanize(surface),
            )
        return Token(
            idx=idx,
            surface=surface,
            is_word=False,
            candidates=[],
            is_ambiguous=False,
            is_oov=False,
            romanization=None,
        )


__all__ = ["StubPipeline"]
