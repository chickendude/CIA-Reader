"""Use Stanza's best dictionary form for each Hindi word. Restore nukta marks from the original
spelling where the model dropped them."""

from __future__ import annotations

import unicodedata

from app.schemas import LemmaCandidate, Token

from .base import PipelineResult
from .stanza_ud import StanzaUDPipeline

_NUKTA = "़"


def _restore_nukta_in_lemma(surface: str, lemma: str) -> str:
    """Copy stem-level nuktas from ``surface`` into ``lemma``.

    Walks both strings in parallel until they diverge (the verb stem
    matches between an inflected surface and its infinitive lemma).
    Whenever the surface has a U+093C that the lemma is missing at
    the aligned position, splice it in. Re-syncs trivially: once
    surface and lemma diverge (the inflectional suffix), the rest
    of the lemma is appended unchanged — nuktas only need restoring
    where the two strings align.

    Idempotent: if Stanza already kept the nukta, surface and lemma
    match nukta-for-nukta and nothing changes. Suppletive lemmas
    (``हूँ`` → ``होना``) diverge after the first character, so no
    nukta gets inserted from the surface and the lemma comes through
    untouched.

    Both inputs are NFC-normalized first because the pipeline's
    contract is NFC throughout, but Stanza's lemma table can
    occasionally hand back atomic precomposed nukta consonants; NFD
    decomposes those to ``base + U+093C`` (composition exclusions
    keep them decomposed under NFC), giving a uniform code-point
    walk regardless of Stanza's internal storage.
    """
    surface = unicodedata.normalize("NFC", surface)
    lemma = unicodedata.normalize("NFC", lemma)
    if _NUKTA not in surface:
        return lemma
    out: list[str] = []
    i = 0
    j = 0
    while i < len(surface) and j < len(lemma):
        if surface[i] == _NUKTA and lemma[j] != _NUKTA:
            out.append(_NUKTA)
            i += 1
            continue
        if surface[i] != lemma[j]:
            break
        out.append(lemma[j])
        i += 1
        j += 1
    out.append(lemma[j:])
    return "".join(out)


def _with_restored_nukta(token: Token) -> Token:
    if not token.is_word or not token.candidates:
        return token
    if _NUKTA not in unicodedata.normalize("NFC", token.surface):
        return token
    new_candidates: list[LemmaCandidate] = []
    changed = False
    for cand in token.candidates:
        fixed = _restore_nukta_in_lemma(token.surface, cand.lemma)
        if fixed == cand.lemma:
            new_candidates.append(cand)
        else:
            new_candidates.append(cand.model_copy(update={"lemma": fixed}))
            changed = True
    if not changed:
        return token
    return token.model_copy(update={"candidates": new_candidates})


class HindiPipeline(StanzaUDPipeline):
    """Stanza-backed Hindi tokenizer + lemmatizer + morphology."""

    pipeline_id = "stanza-hi"

    def process(self, text: str) -> PipelineResult:
        result = super().process(text)
        return PipelineResult(
            pipeline_id=result.pipeline_id,
            tokens=[_with_restored_nukta(tok) for tok in result.tokens],
        )


def build_hindi_pipeline() -> HindiPipeline:  # pragma: no cover
    """Construct a :class:`HindiPipeline` with a real Stanza model.

    Registered in :mod:`app.pipelines.__init__` as the ``stanza-hi``
    factory. Lazy-imports stanza so the module tree stays importable in
    test environments that don't install stanza (CI).

    This legacy factory requires a separately installed Hindi model.
    The reader uses HindiDB.
    """
    import stanza

    from app.languages import LANGUAGES

    desc = LANGUAGES["hi"]
    nlp = stanza.Pipeline(
        lang="hi",
        processors="tokenize,pos,lemma",
        tokenize_no_ssplit=False,
        download_method=None,
        verbose=False,
    )
    return HindiPipeline(
        nlp=nlp,
        script=desc.script,
        roman_scheme=desc.default_romanization,
        # Language hint triggers the schwa-deletion path in
        # :func:`app.romanize.to_roman` so reader output is "rām" not
        # "rāma" for words like राम / कमल / भारत.
        language=desc.code,
    )


__all__ = ["HindiPipeline", "build_hindi_pipeline"]
