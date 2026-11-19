"""Look up the language's registered pipeline and reuse the same instance on later requests. Set
NLP_USE_STUB to run without loading language models."""

from __future__ import annotations

import os
from collections.abc import Callable

from app.languages import LANGUAGES, is_supported_language

from .base import Pipeline, PipelineResult
from .basque import build_basque_pipeline
from .hindi import build_hindi_pipeline
from .hindidb import build_hindidb_pipeline
from .marathi import build_marathi_pipeline
from .odia import build_odia_pipeline
from .stub import StubPipeline
from .yiddish import build_yiddish_pipeline


def _use_stub_pipelines() -> bool:
    """Dev / CI escape hatch: route every pipeline_id to StubPipeline
    when ``NLP_USE_STUB=1``. Useful in environments without the
    Stanza UD models installed (a 250 MB download per language).

    Production sets this to 0 (the default) so the real factories
    kick in.
    """
    return os.environ.get("NLP_USE_STUB", "").lower() in {"1", "true", "yes"}

# Cache of instantiated pipelines keyed by pipeline_id. Building a Stanza
# model is expensive; we want exactly one instance per pipeline_id per
# process. This dict is populated lazily by :func:`get_pipeline`.
_PIPELINE_CACHE: dict[str, Pipeline] = {}

# Factory registry keyed by pipeline_id. Each entry is a zero-arg callable
# that returns a fresh pipeline instance — a class (calls default ctor) or
# a factory function (for pipelines that need real-model construction).
# Keeping factories (not instances) here means we don't pay the model-
# loading cost for languages the running process never touches.
_PIPELINE_FACTORIES: dict[str, Callable[[], Pipeline]] = {
    "stanza-hi": build_hindi_pipeline,
    "hindidb-hi": build_hindidb_pipeline,
    "stanza-mr": build_marathi_pipeline,
    "stanza-eu": build_basque_pipeline,
    "custom-or": build_odia_pipeline,
    "custom-yi": build_yiddish_pipeline,
}


def get_pipeline(language_code: str) -> Pipeline:
    """Return the pipeline for a language code.

    Raises :class:`KeyError` for unsupported languages — callers
    (``/process``) should have validated the code first and translated any
    error into an HTTP 400.
    """
    if not is_supported_language(language_code):
        raise KeyError(f"Unsupported language: {language_code!r}")
    pipeline_id = LANGUAGES[language_code].pipeline_id
    if pipeline_id not in _PIPELINE_CACHE:
        if _use_stub_pipelines():
            # Per-language stub instance so the pipeline knows what
            # script + romanization scheme to use when generating
            # The optional roman layer.
            descriptor = LANGUAGES[language_code]
            _PIPELINE_CACHE[pipeline_id] = StubPipeline(
                script=descriptor.script,
                roman_scheme=descriptor.default_romanization,
                language=descriptor.code,
            )
        else:
            factory = _PIPELINE_FACTORIES.get(pipeline_id, StubPipeline)
            _PIPELINE_CACHE[pipeline_id] = factory()
    return _PIPELINE_CACHE[pipeline_id]


def reset_pipeline_cache() -> None:
    """Test hook: drop cached pipeline instances.

    Useful when a test overrides :data:`_PIPELINE_FACTORIES` and wants to
    guarantee its factory is called instead of returning a stale cached
    pipeline from a prior test.
    """
    _PIPELINE_CACHE.clear()


__all__ = [
    "Pipeline",
    "PipelineResult",
    "StubPipeline",
    "get_pipeline",
    "reset_pipeline_cache",
]
