"""Analyze Odia words using spelling rules and a small dictionary. A spelling can have more than
one analysis, so keep the alternatives for the reader."""

from __future__ import annotations

from collections.abc import Callable

from app.numbers import number_forms as _compute_number_forms
from app.schemas import LemmaCandidate, Token

from ..base import Pipeline, PipelineResult
from ..word_types import should_treat_as_word
from .lemmas import OdiaLemmaTable
from .morph import MorphAnalysis, analyze

OdiaTokenizer = Callable[[str], list[str]]


# Matches :mod:`app.pipelines.marathi`'s fallback punctuation set —
# expanded slightly to cover the Odia sign visarga. Keeping these in
# sync across pipelines ensures the reader sees the same is_word /
# is_oov semantics regardless of language.
_PUNCT_CHARS: frozenset[str] = frozenset(
    ".,;:!?\u0964\u0965\"'()[]{}<>/\\|-—–"
)


def _is_punctuation(surface: str) -> bool:
    return bool(surface) and all(c in _PUNCT_CHARS for c in surface)


def _candidate_from_analysis(analysis: MorphAnalysis, score: float) -> LemmaCandidate:
    return LemmaCandidate(
        lemma=analysis.lemma.headword,
        pos=analysis.lemma.pos,
        score=score,
        features=dict(analysis.features),
    )


def _candidates_for_analyses(analyses: list[MorphAnalysis]) -> list[LemmaCandidate]:
    """Give each possible analysis an equal score. The rules do not estimate how likely one reading
    is compared with another."""
    if not analyses:
        return []
    score = 1.0 / len(analyses)
    return [_candidate_from_analysis(a, score=score) for a in analyses]


class OdiaPipeline(Pipeline):
    """IndicNLP tokenizer + rule-based morphology + seed lemma lookup."""

    pipeline_id = "custom-or"

    def __init__(
        self,
        tokenizer: OdiaTokenizer,
        lemmas: OdiaLemmaTable,
    ) -> None:
        self._tokenizer = tokenizer
        self._lemmas = lemmas

    def process(self, text: str) -> PipelineResult:
        # Keep the spaces between words so the reader can lay out the original passage.
        tokens: list[Token] = []
        idx = 0
        cursor = 0
        for surface in self._tokenizer(text):
            if not surface:
                continue
            start = text.find(surface, cursor)
            if start == -1:
                # Tokenizer mutated the surface (NFC, escape tweaks, …).
                # Emit the token as-is and advance the cursor by its
                # length so we don't loop the same gap forever.
                tokens.append(self._build_token(idx, surface))
                idx += 1
                cursor += len(surface)
                continue
            if start > cursor:
                tokens.append(self._make_gap_token(idx, text[cursor:start]))
                idx += 1
            tokens.append(self._build_token(idx, surface))
            idx += 1
            cursor = start + len(surface)
        if cursor < len(text):
            tail = text[cursor:]
            if tail:
                tokens.append(self._make_gap_token(idx, tail))
        return PipelineResult(pipeline_id=self.pipeline_id, tokens=tokens)

    @staticmethod
    def _make_gap_token(idx: int, surface: str) -> Token:
        return Token(
            idx=idx,
            surface=surface,
            is_word=False,
            candidates=[],
            is_ambiguous=False,
            is_oov=False,
            romanization=None,
        )

    def _build_token(self, idx: int, surface: str) -> Token:
        if _is_punctuation(surface):
            return Token(
                idx=idx,
                surface=surface,
                is_word=False,
                candidates=[
                    LemmaCandidate(lemma=surface, pos="PUNCT", score=1.0, features={}),
                ],
                is_ambiguous=False,
                is_oov=False,
                romanization=None,
            )

        analyses = analyze(surface, self._lemmas)
        candidates = _candidates_for_analyses(analyses)
        is_oov = not candidates
        if is_oov:
            # Fallback candidate so downstream consumers always have a
            # LemmaCandidate to display — same convention the stub uses.
            candidates = [
                LemmaCandidate(lemma=surface, pos="X", score=1.0, features={}),
            ]

        is_word = should_treat_as_word(
            surface,
            candidates[0].pos,
            script="Orya",
        )
        return Token(
            idx=idx,
            surface=surface,
            is_word=is_word,
            candidates=candidates,
            # Multiple morphological analyses means the reader should
            # Surface the "N possible meanings" chevron.
            is_ambiguous=len(analyses) >= 2,
            is_oov=is_word and is_oov,
            romanization=None,
            number_forms=_compute_number_forms(surface),
        )
