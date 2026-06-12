"""Custom Yiddish pipeline.

No Stanza model exists for Yiddish (UD has no released Yiddish
treebank), so this is the second custom pipeline after Odia, with the
same three pieces:

1. **Tokenization** — a small regex tokenizer. Yiddish is whitespace-
   and-punctuation segmented, so unlike Odia there's no IndicNLP
   dependency; a word is a run of Hebrew-block letters (with their
   combining points and the װ/ױ/ײ ligatures).
2. **Morphological analyzer** — :mod:`app.pipelines.yiddish.morph`,
   suffix + גע־ circumfix rules over a lemma table with stem and
   irregular-form indexes.
3. **Lemma lookup** — :mod:`app.pipelines.yiddish.lemmas`, a seed
   table hand-curated for bootstrap; the Kaikki Yiddish import
   populates the real Postgres ``lemmas`` table.

Output contract is identical to the other pipelines — ``Token`` list
with top-K ``LemmaCandidate``, ``is_word`` / ``is_oov`` /
``is_ambiguous`` — so the reader and correction flow don't branch on
language. Word tokens additionally carry a YIVO romanization from
:func:`app.romanize.to_roman`, the same way the Stanza pipelines
attach ISO 15919.

``number_forms`` is deliberately left ``None``: the NumberForms
payload spells numerals out in Hindi / Marathi / Odia, which is
meaningless in a Yiddish reader. Yiddish spelled-out numerals are a
follow-up to :mod:`app.numbers`.

**Accuracy expectation**: same tier as Odia (~70–80% lemma accuracy at
launch against the golden corpus), improving with dictionary growth
and crowdsourced corrections. The unpointed loshn-koydesh vocabulary
is the known weak spot — it's spelled etymologically, so affix rules
and rule-based romanization both undershoot there.
"""

from __future__ import annotations

import re
from collections.abc import Callable

from app.romanize import UnsupportedScriptError, to_roman
from app.schemas import LemmaCandidate, Token

from ..base import Pipeline, PipelineResult
from ..stanza_ud import should_treat_as_word
from .lemmas import YiddishLemmaTable, default_lemma_table
from .morph import MorphAnalysis, analyze

YiddishTokenizer = Callable[[str], list[str]]


# A word: a Hebrew-block letter (or װ/ױ/ײ ligature) followed by letters
# and combining points (the YIVO pointing — pasekh, komets, rafe, etc. —
# lives in U+0591-U+05C7). Digits and Latin runs token as units so
# code-switched fragments survive intact; anything else non-space is a
# single punctuation token. The offset walk in :meth:`process`
# reconstructs whitespace gaps, so the tokenizer only returns visible
# tokens — same contract as IndicNLP's trivial_tokenize for Odia.
_TOKEN_RE = re.compile(
    r"[א-תװ-ײ][א-תװ-ײ֑-ׇ]*"
    r"|\d+"
    r"|[A-Za-z]+"
    r"|[^\s]"
)


def yiddish_tokenize(text: str) -> list[str]:
    """Production tokenizer: pure-regex, no external dependency."""
    return _TOKEN_RE.findall(text)


# Matches the other pipelines' punctuation sets, extended with the
# Hebrew-block marks Yiddish text uses: geresh (׳), gershayim (״) and
# maqaf (־). Keeping these in sync across pipelines keeps is_word /
# is_oov semantics identical regardless of language.
_PUNCT_CHARS: frozenset[str] = frozenset(
    ".,;:!?\"'()[]{}<>/\\|-—–׳״־…"
)


def _is_punctuation(surface: str) -> bool:
    return bool(surface) and all(c in _PUNCT_CHARS for c in surface)


def _candidates_for_analyses(analyses: list[MorphAnalysis]) -> list[LemmaCandidate]:
    """Convert analyzer output to a ranked candidate list.

    Rule-based morphology has no probabilistic model, so scores are
    uniform (1/N) and ``is_ambiguous`` is what the reader surfaces —
    same convention as the Odia pipeline.
    """
    if not analyses:
        return []
    score = 1.0 / len(analyses)
    return [
        LemmaCandidate(
            lemma=a.lemma.headword,
            pos=a.lemma.pos,
            score=score,
            features=dict(a.features),
        )
        for a in analyses
    ]


class YiddishPipeline(Pipeline):
    """Regex tokenizer + rule-based morphology + seed lemma lookup."""

    pipeline_id = "custom-yi"

    def __init__(
        self,
        tokenizer: YiddishTokenizer,
        lemmas: YiddishLemmaTable,
    ) -> None:
        self._tokenizer = tokenizer
        self._lemmas = lemmas

    def process(self, text: str) -> PipelineResult:
        # Offset walk mirroring :class:`OdiaPipeline.process`: the gaps
        # between tokenizer outputs become `is_word=False` tokens so the
        # reader preserves whitespace and paragraph breaks.
        tokens: list[Token] = []
        idx = 0
        cursor = 0
        for surface in self._tokenizer(text):
            if not surface:
                continue
            start = text.find(surface, cursor)
            if start == -1:
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
            candidates = [
                LemmaCandidate(lemma=surface, pos="X", score=1.0, features={}),
            ]

        is_word = should_treat_as_word(
            surface,
            candidates[0].pos,
            script="Hebr",
        )
        return Token(
            idx=idx,
            surface=surface,
            is_word=is_word,
            candidates=candidates,
            is_ambiguous=len(analyses) >= 2,
            is_oov=is_word and is_oov,
            romanization=self._romanize(surface) if is_word else None,
        )

    @staticmethod
    def _romanize(surface: str) -> str | None:
        try:
            return to_roman(
                surface,
                from_script="Hebr",
                to_scheme="yivo",
                language="yi",
            )
        except UnsupportedScriptError:  # pragma: no cover — Hebr is supported
            return None


def build_yiddish_pipeline() -> YiddishPipeline:
    """Construct a :class:`YiddishPipeline` with the production tokenizer + seed.

    Registered in :mod:`app.pipelines.__init__` as the ``custom-yi``
    factory. Unlike Odia there's nothing to lazy-import — the tokenizer
    is a regex — so CI exercises the production configuration directly.
    """
    return YiddishPipeline(
        tokenizer=yiddish_tokenize,
        lemmas=default_lemma_table(),
    )


__all__ = [
    "YiddishPipeline",
    "YiddishTokenizer",
    "build_yiddish_pipeline",
    "yiddish_tokenize",
]
