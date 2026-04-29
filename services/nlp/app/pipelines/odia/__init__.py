"""Custom Odia pipeline (T-2.3a).

Stanza's ``or`` support is thin — lemma accuracy on real-world Odia text
runs below usable thresholds and the model is maintenance-light, so we
build our own pipeline with three pieces:

1. **Tokenization** — IndicNLP's ``indic_tokenize.trivial_tokenize``,
   which is already Odia-aware (handles Odia punctuation and clitics).
2. **Morphological analyzer** — :mod:`app.pipelines.odia.morph`, a
   rule-based stripper that tries a small set of suffix rules and
   checks whether the stripped stem is in the lemma table.
3. **Lemma lookup** — :mod:`app.pipelines.odia.lemmas`, a seed table
   hand-curated for MVP and (in T-3.1) replaced by a large-scale import
   from Odia WordNet / OdiaNLP resources.

Output contract is identical to :class:`app.pipelines.stanza_ud.StanzaUDPipeline`'s
— ``Token`` list with top-K ``LemmaCandidate``, ``is_word``, ``is_oov``,
``is_ambiguous`` — so the reader, dictionary editor, and correction
flow don't branch on language.

**Accuracy expectation**: the plan targets ~70–80% lemma accuracy at
launch, improving as crowdsourced corrections (T-6.7) accumulate and
the dictionary grows (M3). That's explicitly below Hindi (~90%) and
Marathi (~80%). The correction UX in M6 is the pressure valve.
"""

from __future__ import annotations

from collections.abc import Callable

from app.numbers import number_forms as _compute_number_forms
from app.schemas import LemmaCandidate, Token

from ..base import Pipeline, PipelineResult
from ..stanza_ud import should_treat_as_word
from .lemmas import OdiaLemmaTable, default_lemma_table
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
    """Convert an analyzer result to a ranked candidate list.

    Rule-based morphology has no probabilistic model, so we distribute
    scores uniformly across the N analyses (1/N each). When a single
    candidate source lands on top of this (M3 dictionary attachment or
    T-6.7 overrides), the score distribution will narrow to reflect
    real confidence — until then ``is_ambiguous`` is what the reader
    surfaces to the user.
    """
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
        tokens: list[Token] = []
        for idx, surface in enumerate(s for s in self._tokenizer(text) if s):
            tokens.append(self._build_token(idx, surface))
        return PipelineResult(pipeline_id=self.pipeline_id, tokens=tokens)

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
            # surface the "N possible meanings" chevron (M6).
            is_ambiguous=len(analyses) >= 2,
            is_oov=is_word and is_oov,
            romanization=None,
            number_forms=_compute_number_forms(surface),
        )


def _indicnlp_odia_tokenize(text: str) -> list[str]:  # pragma: no cover
    """Production tokenizer: IndicNLP's Odia-aware trivial tokenizer."""
    from indicnlp.tokenize import indic_tokenize

    return list(indic_tokenize.trivial_tokenize(text, lang="or"))


def build_odia_pipeline() -> OdiaPipeline:  # pragma: no cover
    """Construct an :class:`OdiaPipeline` with the production tokenizer + seed.

    Registered in :mod:`app.pipelines.__init__` as the ``custom-or``
    factory. Lazy-imports IndicNLP so CI doesn't need it installed —
    tests inject a split-based tokenizer fake instead.
    """
    return OdiaPipeline(
        tokenizer=_indicnlp_odia_tokenize,
        lemmas=default_lemma_table(),
    )


__all__ = ["OdiaPipeline", "OdiaTokenizer", "build_odia_pipeline"]
