"""Analyze Basque text with Stanza. The shared adapter handles word boundaries, dictionary forms
and grammatical features."""

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
