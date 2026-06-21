"""Basque pipeline backed by Stanza's ``eu`` UD model (UD_Basque-BDT).

Like Hindi (T-2.2) and Marathi (T-2.3), Basque runs Stanza's UD pipeline and
produces the same :class:`Token` shape. All of the output-shaping logic
(feature parsing, OOV heuristics, idx sequencing, inter-word whitespace gap
tokens) lives in :class:`app.pipelines.stanza_ud.StanzaUDPipeline`, so this
module is a thin wrapper that sets the canonical ``pipeline_id`` and provides a
factory that constructs the real Stanza model at startup.

Basque differs from the Indic languages in two ways that *simplify* this
module:

* **Latin script, no romanization.** The reader renders Basque as-is, so the
  factory passes ``roman_scheme=None`` and no optional roman layer is produced.
  ``script="Latn"`` is still forwarded so the base class's "drop foreign-script
  fragments" heuristic in :func:`should_treat_as_word` can keep stray non-Latin
  tokens out of the reader's word UX (see ``_SCRIPT_RANGES`` in ``stanza_ud``).
* **No multi-word tokens.** UD_Basque-BDT has no MWT, so ``processors`` is the
  same ``tokenize,pos,lemma`` triple the Indic models use — Stanza's word
  stream maps 1:1 to surface tokens, no ``mwt`` processor required.

Top-K / OOV / ambiguity contract is identical to Hindi (single best lemma,
``is_ambiguous`` always ``False`` until dictionary candidates land in M3). The
BDT model is well-resourced, so ``is_oov`` should fire less often than for
Marathi; the correction UX (M6) carries the remainder.
"""

from __future__ import annotations

from .stanza_ud import StanzaUDPipeline


class BasquePipeline(StanzaUDPipeline):
    """Stanza-backed Basque tokenizer + lemmatizer + morphology."""

    pipeline_id = "stanza-eu"


def build_basque_pipeline() -> BasquePipeline:  # pragma: no cover
    """Construct a :class:`BasquePipeline` with a real Stanza model.

    Registered in :mod:`app.pipelines.__init__` as the ``stanza-eu`` factory.
    Lazy-imports stanza so the module tree stays importable in test
    environments that don't install stanza (the default CI lane).

    The Docker image pre-downloads the Basque model at build time via
    ``stanza.download('eu', processors='tokenize,pos,lemma')``;
    ``download_method=None`` here prevents a surprise download from happening
    in production at first-request time.
    """
    import stanza

    from app.languages import LANGUAGES

    desc = LANGUAGES["eu"]
    nlp = stanza.Pipeline(
        lang="eu",
        processors="tokenize,pos,lemma",
        tokenize_no_ssplit=False,
        download_method=None,
        verbose=False,
    )
    return BasquePipeline(
        nlp=nlp,
        script=desc.script,
        # Latin script — no romanization layer; the reader renders Basque
        # as-is, so the optional roman scheme stays unset.
        roman_scheme=None,
    )


__all__ = ["BasquePipeline", "build_basque_pipeline"]
