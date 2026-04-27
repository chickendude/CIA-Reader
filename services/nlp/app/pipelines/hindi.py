"""Hindi pipeline backed by Stanza's ``hi`` UD model.

Stanza handles tokenization, POS tagging, lemmatization, and UD-style
morphology features. We wrap its output in our common :class:`Token`
shape so the HTTP layer doesn't branch per language.

Top-K caveat (see T-2.2 in the plan): Stanza's lemmatizer exposes a
single best lemma per word. Real top-K lemma candidates with softmax-
normalized scores require either beam decoder internals or a dictionary-
side fallback — both land later (dictionary candidates in M3, beam
alternates in a future pass). Until then we emit a single-candidate
top-K, and :attr:`Token.is_ambiguous` is always ``False``. Downstream
UX (M6) only branches on ``is_ambiguous``, so it gracefully degrades
to "no chevron" for now.

OOV heuristic: when Stanza returns the surface as the lemma *and* the
UD POS isn't punctuation / symbol / number / proper-noun, we treat it
as OOV. That matches the plan's "Stanza returns surface + no dictionary
match" definition closely enough for MVP — real dictionary attachment
happens in M3 and will refine ``is_oov`` at that point.
"""

from __future__ import annotations

from typing import Any, Protocol

from app.schemas import LemmaCandidate, Token

from .base import Pipeline, PipelineResult


class _StanzaLike(Protocol):
    """The subset of Stanza's ``Pipeline`` callable we depend on.

    Using a structural type lets tests inject a lightweight fake without
    importing stanza (and without having to install torch in CI). The
    production code path lazy-imports stanza in :func:`build_hindi_pipeline`.
    """

    def __call__(self, text: str) -> Any: ...  # noqa: D401,E704


# UD UPOS tags where "lemma equals surface" does NOT imply OOV. A proper
# noun's lemma is its surface by design; punctuation / symbols / digits
# legitimately don't have dictionary lemmas; ``X`` is Stanza's other-
# language marker and is effectively a code-switch signal.
_NON_OOV_UPOS: frozenset[str] = frozenset({"PUNCT", "SYM", "NUM", "PROPN", "X"})

# UD UPOS tags that aren't lexical words. The Token schema exposes
# ``is_word`` so the reader can skip these when counting known-words.
_NON_WORD_UPOS: frozenset[str] = frozenset({"PUNCT", "SYM"})


def _parse_feats(feats: str | None) -> dict[str, str]:
    """Turn Stanza's ``"Tense=Pres|Number=Sing"`` into a plain dict.

    Stanza uses ``None`` (or an empty string) when a word has no features.
    Malformed pairs are skipped rather than raising — morphology drift
    between Stanza model versions shouldn't 500 a /process call.
    """
    if not feats:
        return {}
    out: dict[str, str] = {}
    for pair in feats.split("|"):
        if "=" not in pair:
            continue
        key, _, value = pair.partition("=")
        key = key.strip()
        value = value.strip()
        if key:
            out[key] = value
    return out


class HindiPipeline(Pipeline):
    """Stanza-backed Hindi tokenizer + lemmatizer + morphology."""

    pipeline_id = "stanza-hi"

    def __init__(self, nlp: _StanzaLike) -> None:
        # The stanza model is injected (built by :func:`build_hindi_pipeline`
        # in production; a fake in tests) so this class has no direct import
        # dependency on stanza — keeps the module importable in CI without
        # stanza + torch installed.
        self._nlp = nlp

    def process(self, text: str) -> PipelineResult:
        doc = self._nlp(text)
        tokens: list[Token] = []
        idx = 0
        for sentence in doc.sentences:
            for word in sentence.words:
                surface = word.text
                lemma = word.lemma or surface
                upos = (word.upos or "X").upper()
                features = _parse_feats(word.feats)
                is_word = upos not in _NON_WORD_UPOS
                is_oov = lemma == surface and upos not in _NON_OOV_UPOS
                tokens.append(
                    Token(
                        idx=idx,
                        surface=surface,
                        is_word=is_word,
                        candidates=[
                            LemmaCandidate(
                                lemma=lemma,
                                pos=upos,
                                score=1.0,
                                features=features,
                            ),
                        ],
                        is_ambiguous=False,
                        is_oov=is_oov,
                        romanization=None,
                    )
                )
                idx += 1
        return PipelineResult(pipeline_id=self.pipeline_id, tokens=tokens)


def build_hindi_pipeline() -> HindiPipeline:  # pragma: no cover
    """Construct a :class:`HindiPipeline` with a real Stanza model.

    Registered in :mod:`app.pipelines.__init__` as the ``stanza-hi``
    factory. Lazy-imports stanza so the module tree stays importable in
    test environments that don't install stanza (CI).

    The Docker image for the NLP service pre-downloads models at build
    time via ``stanza.download('hi', processors='tokenize,pos,lemma')``;
    ``download_method=None`` here prevents a surprise download from
    happening in production at first-request time.
    """
    import stanza

    nlp = stanza.Pipeline(
        lang="hi",
        processors="tokenize,pos,lemma",
        tokenize_no_ssplit=False,
        download_method=None,
        verbose=False,
    )
    return HindiPipeline(nlp=nlp)


__all__ = ["HindiPipeline", "build_hindi_pipeline"]
