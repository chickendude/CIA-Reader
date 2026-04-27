"""Marathi pipeline backed by Stanza's ``mr`` UD model.

Output shape and OOV / ambiguity contract match the Hindi pipeline — the
same :class:`StanzaUDPipeline` base handles tokenization / lemma / POS /
morphology feature extraction.

Marathi accuracy caveat (from the plan): Stanza's ``mr`` model runs at
~75–85% real-world accuracy versus ~90% for Hindi, so we expect
``is_oov`` to fire more often. The correction UX in M6 carries the
weight of that. No pipeline-side workarounds here — the correct place
to improve parse quality is crowdsourced overrides (T-2.7 / T-6.7) and
the dictionary (M3), not by guessing in the tokenizer.

**IndicNLP fallback**: Stanza's Marathi tokenizer has known issues on
short, punctuation-heavy, or informal inputs where it can emit zero
tokens for non-empty text. When that happens we fall back to
IndicNLP's ``indic_tokenize.trivial_tokenize(..., lang='mr')`` (which
is already script-aware and handles Devanagari clitics) to at least
surface the words with ``is_oov=True``. The fallback is injected so
tests don't need IndicNLP installed.
"""

from __future__ import annotations

from collections.abc import Callable

from app.schemas import LemmaCandidate, Token

from .base import PipelineResult
from .stanza_ud import NON_WORD_UPOS, StanzaLike, StanzaUDPipeline

MarathiTokenizer = Callable[[str], list[str]]


# Minimal set of characters treated as punctuation by the fallback
# tokenizer. This deliberately undershoots — punctuation-heavy surfaces
# aren't the common case for the fallback path, and being strict here
# keeps the function side-effect-free without pulling in
# unicodedata.category checks on every char.
_FALLBACK_PUNCT: frozenset[str] = frozenset(
    ".,;:!?\u0964\u0965\"'()[]{}<>/\\|-—–"
)


def _is_fallback_punct(surface: str) -> bool:
    return bool(surface) and all(c in _FALLBACK_PUNCT for c in surface)


def _fallback_token(idx: int, surface: str) -> Token:
    is_punct = _is_fallback_punct(surface)
    upos = "PUNCT" if is_punct else "X"
    return Token(
        idx=idx,
        surface=surface,
        # NON_WORD_UPOS is imported so the reader's is_word predicate
        # stays consistent with the Stanza path for the same UPOS.
        is_word=upos not in NON_WORD_UPOS,
        candidates=[LemmaCandidate(lemma=surface, pos=upos, score=1.0, features={})],
        is_ambiguous=False,
        # Fallback tokens are by definition OOV — Stanza produced nothing,
        # so there's no dictionary lemma. Punctuation is exempt by the
        # same rule the Stanza path uses.
        is_oov=not is_punct,
        romanization=None,
    )


class MarathiPipeline(StanzaUDPipeline):
    """Stanza-backed Marathi pipeline with an IndicNLP fallback tokenizer."""

    pipeline_id = "stanza-mr"

    def __init__(
        self,
        nlp: StanzaLike,
        *,
        fallback_tokenizer: MarathiTokenizer,
        script: str | None = None,
        roman_scheme: str | None = None,
    ) -> None:
        super().__init__(nlp=nlp, script=script, roman_scheme=roman_scheme)
        self._fallback_tokenizer = fallback_tokenizer

    def process(self, text: str) -> PipelineResult:
        result = super().process(text)
        # Fallback only triggers when Stanza produced no tokens for
        # clearly non-empty input. The common "whitespace-only" case
        # still returns an empty token list as expected.
        if text.strip() and not result.tokens:
            return self._fallback_process(text)
        return result

    def _fallback_process(self, text: str) -> PipelineResult:
        surfaces = self._fallback_tokenizer(text)
        tokens = [_fallback_token(i, s) for i, s in enumerate(surfaces) if s]
        return PipelineResult(pipeline_id=self.pipeline_id, tokens=tokens)


def _indicnlp_marathi_tokenize(text: str) -> list[str]:  # pragma: no cover
    """Production fallback: IndicNLP's trivial tokenizer for Marathi."""
    from indicnlp.tokenize import indic_tokenize

    return list(indic_tokenize.trivial_tokenize(text, lang="mr"))


def build_marathi_pipeline() -> MarathiPipeline:  # pragma: no cover
    """Construct a :class:`MarathiPipeline` with a real Stanza model.

    Registered in :mod:`app.pipelines.__init__` as the ``stanza-mr``
    factory. Lazy-imports stanza and IndicNLP so CI doesn't need either.
    The Docker image pre-downloads the Marathi Stanza model at build
    time; ``download_method=None`` keeps request paths offline-safe.
    """
    import stanza

    from app.languages import LANGUAGES

    desc = LANGUAGES["mr"]
    nlp = stanza.Pipeline(
        lang="mr",
        processors="tokenize,pos,lemma",
        tokenize_no_ssplit=False,
        download_method=None,
        verbose=False,
    )
    return MarathiPipeline(
        nlp=nlp,
        fallback_tokenizer=_indicnlp_marathi_tokenize,
        script=desc.script,
        roman_scheme=desc.default_romanization,
    )


__all__ = ["MarathiPipeline", "MarathiTokenizer", "build_marathi_pipeline"]
