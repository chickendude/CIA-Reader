"""Hindi pipeline backed by Stanza's ``hi`` UD model.

Stanza handles tokenization, POS tagging, lemmatization, and UD-style
morphology features. All of the output-shaping logic (feature parsing,
OOV heuristics, idx sequencing) lives in
:class:`app.pipelines.stanza_ud.StanzaUDPipeline` so this module is a
thin wrapper that sets the canonical ``pipeline_id`` and provides a
factory that constructs the real Stanza model at startup.

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

Lemma overrides for finite copulas (``है`` → ``होना`` and friends)
land via the ``form_lemma_overrides`` table (T-2.7) — the dispatcher
consults that map BEFORE accepting Stanza's top candidate, so this
module stays focused on the raw UD output.

Nukta restoration: Stanza's ``hi_hdtb`` model strips the nukta
(U+093C) from lemmas of nukta-bearing verbs and nouns — surface
``पढ़ता`` lemmatizes to ``पढना`` instead of the correct ``पढ़ना``,
and the same bug hits ``बढ़ना``, ``चढ़ना``, ``लड़ना``, ``पकड़ना``,
``छोड़ना``, etc. The HDTB treebank itself has inconsistent nukta
marking, so this is upstream-baked. We compensate with a
deterministic post-processor (:func:`_restore_nukta_in_lemma`) that
copies any nuktas surviving in the surface back into the lemma at
the aligned stem position. Runs on every word token's candidates
*after* the base class has set ``is_oov`` from the raw Stanza output,
so a fixed lemma that happens to equal the surface (e.g. when the
infinitive itself appears in text) doesn't spuriously flip OOV.
"""

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

    The Docker image for the NLP service pre-downloads models at build
    time via ``stanza.download('hi', processors='tokenize,pos,lemma')``;
    ``download_method=None`` here prevents a surprise download from
    happening in production at first-request time.
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
