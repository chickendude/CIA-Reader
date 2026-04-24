"""Per-language NLP pipeline dispatch.

Each supported MVP language (hi, mr, or) is produced by its own pipeline
in a dedicated module: `hindi.py`, `marathi.py`, `odia.py`. The registry
below maps a `pipeline_id` (as declared by the shared language registry
in ``packages/shared-types/python/languages.py``) to its implementation.

The pipelines all share the same output shape — a list of ``Token`` rows
with top-K lemma candidates, ambiguity / OOV flags, and an optional
romanization — so the web service (and future mobile clients) never
branch on language when rendering or persisting.

Right now every pipeline_id is wired to the canned :class:`StubPipeline`;
T-2.2 / T-2.3 / T-2.3a will swap each mapping for the real implementation
without touching the dispatch layer.
"""

from __future__ import annotations

from collections.abc import Callable

from app.languages import LANGUAGES, is_supported_language

from .base import Pipeline, PipelineResult
from .hindi import build_hindi_pipeline
from .marathi import build_marathi_pipeline
from .odia import build_odia_pipeline
from .stub import StubPipeline

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
    "stanza-mr": build_marathi_pipeline,
    "custom-or": build_odia_pipeline,
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
