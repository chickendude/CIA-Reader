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
"""

from __future__ import annotations

from .stanza_ud import StanzaUDPipeline


class HindiPipeline(StanzaUDPipeline):
    """Stanza-backed Hindi tokenizer + lemmatizer + morphology."""

    pipeline_id = "stanza-hi"


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
