"""Select the reader's dictionary matcher for each language."""

from collections.abc import Callable

from app.languages import LANGUAGES, is_supported_language

from .base import Pipeline, PipelineResult
from .dictionary import DictionaryPipeline
from .hindidb import build_hindidb_pipeline
from .stub import StubPipeline

_PIPELINE_CACHE: dict[str, Pipeline] = {}
_PIPELINE_FACTORIES: dict[str, Callable[[], Pipeline]] = {
    "hindidb-hi": build_hindidb_pipeline,
}


def get_pipeline(language_code: str) -> Pipeline:
    if not is_supported_language(language_code):
        raise KeyError(f"Unsupported language: {language_code!r}")
    pipeline_id = LANGUAGES[language_code].pipeline_id
    if pipeline_id not in _PIPELINE_CACHE:
        factory = _PIPELINE_FACTORIES.get(pipeline_id)
        _PIPELINE_CACHE[pipeline_id] = factory() if factory else DictionaryPipeline(language_code)
    return _PIPELINE_CACHE[pipeline_id]


def reset_pipeline_cache() -> None:
    _PIPELINE_CACHE.clear()


__all__ = ["Pipeline", "PipelineResult", "StubPipeline", "get_pipeline", "reset_pipeline_cache"]
