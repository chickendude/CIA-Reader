"""Shared output-shaping for Stanza UD-style pipelines.

Hindi (T-2.2) and Marathi (T-2.3) both run Stanza's UD pipeline and
produce the same :class:`Token` shape. The language-agnostic parts —
iterating over ``doc.sentences[*].words``, parsing UD ``feats`` into a
dict, applying the OOV / ``is_word`` POS heuristics — live here so one
subclass can't accidentally diverge from the other's contract.

Each concrete per-language class (``HindiPipeline``, ``MarathiPipeline``)
is a thin subclass that sets ``pipeline_id`` and is constructed with an
already-initialized stanza-like ``nlp`` object. The real model loading
happens in the corresponding ``build_<lang>_pipeline`` factory.
"""

from __future__ import annotations

from typing import Any, Protocol

from app.schemas import LemmaCandidate, Token

from .base import Pipeline, PipelineResult


class StanzaLike(Protocol):
    """The subset of Stanza's ``Pipeline`` callable we depend on.

    Using a structural type lets tests inject a lightweight fake without
    importing stanza (and without having to install torch in CI). The
    production code path lazy-imports stanza in each ``build_*_pipeline``.
    """

    def __call__(self, text: str) -> Any: ...  # noqa: D401,E704


# UD UPOS tags where "lemma equals surface" does NOT imply OOV. A proper
# noun's lemma is its surface by design; punctuation / symbols / digits
# legitimately don't have dictionary lemmas; ``X`` is Stanza's other-
# language marker and is effectively a code-switch signal.
NON_OOV_UPOS: frozenset[str] = frozenset({"PUNCT", "SYM", "NUM", "PROPN", "X"})

# UD UPOS tags that aren't lexical words. The reader uses ``is_word`` to
# skip these when counting known-words and when rendering the pop-up.
NON_WORD_UPOS: frozenset[str] = frozenset({"PUNCT", "SYM"})


def parse_feats(feats: str | None) -> dict[str, str]:
    """Turn Stanza's ``"Tense=Pres|Number=Sing"`` string into a dict.

    Stanza uses ``None`` (or an empty string) when a word has no
    features. Malformed pairs are skipped rather than raising —
    morphology drift between Stanza model versions shouldn't 500 a
    ``/process`` call.
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


class StanzaUDPipeline(Pipeline):
    """Base class that turns a Stanza doc into our :class:`Token` list."""

    # Subclasses set their own canonical pipeline_id, used to echo back
    # which implementation produced the parse.
    pipeline_id: str

    def __init__(self, nlp: StanzaLike) -> None:
        self._nlp = nlp

    def process(self, text: str) -> PipelineResult:
        doc = self._nlp(text)
        tokens = list(self._tokens_from_doc(doc))
        return PipelineResult(pipeline_id=self.pipeline_id, tokens=tokens)

    def _tokens_from_doc(self, doc: Any) -> list[Token]:
        tokens: list[Token] = []
        idx = 0
        for sentence in doc.sentences:
            for word in sentence.words:
                surface = word.text
                lemma = word.lemma or surface
                upos = (word.upos or "X").upper()
                features = parse_feats(word.feats)
                is_word = upos not in NON_WORD_UPOS
                is_oov = lemma == surface and upos not in NON_OOV_UPOS
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
        return tokens


__all__ = [
    "NON_OOV_UPOS",
    "NON_WORD_UPOS",
    "StanzaLike",
    "StanzaUDPipeline",
    "parse_feats",
]
