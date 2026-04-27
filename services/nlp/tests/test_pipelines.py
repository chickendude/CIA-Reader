"""Tests for the pipeline dispatch layer (T-2.1).

These tests isolate the dispatch behavior from the HTTP layer — they go
directly against :mod:`app.pipelines` so regressions show up with a
pinpointed stack trace, not a FastAPI 500.
"""

from __future__ import annotations

import pytest

from app import pipelines
from app.pipelines import Pipeline, PipelineResult, StubPipeline, get_pipeline
from app.schemas import LemmaCandidate, Token


@pytest.fixture(autouse=True)
def _clear_cache():
    pipelines.reset_pipeline_cache()
    yield
    pipelines.reset_pipeline_cache()


def test_get_pipeline_returns_stub_for_each_supported_language():
    for code in ("hi", "mr", "or"):
        pipe = get_pipeline(code)
        assert isinstance(pipe, Pipeline)
        # MVP: every language routes through the stub until real pipelines ship.
        assert isinstance(pipe, StubPipeline)


def test_get_pipeline_reuses_instance_per_pipeline_id():
    # Both Hindi and Marathi currently route to the same stub pipeline_id
    # wouldn't be equal — they're distinct pipeline_ids — so we compare
    # against repeat lookups for the same language instead.
    a = get_pipeline("hi")
    b = get_pipeline("hi")
    assert a is b, "dispatcher must cache the instance per pipeline_id"


def test_get_pipeline_rejects_unsupported_language():
    with pytest.raises(KeyError):
        get_pipeline("ja")


def test_stub_pipeline_whitespace_tokenizes_and_marks_oov():
    out = StubPipeline().process("नमस्ते दुनिया")
    assert isinstance(out, PipelineResult)
    assert [t.surface for t in out.tokens] == ["नमस्ते", "दुनिया"]
    assert all(t.is_oov for t in out.tokens), "stub must mark every token OOV"
    assert all(len(t.candidates) == 1 for t in out.tokens)
    assert isinstance(out.tokens[0].candidates[0], LemmaCandidate)


def test_stub_pipeline_returns_valid_token_shape():
    out = StubPipeline().process("one two")
    tok: Token = out.tokens[0]
    assert tok.idx == 0
    assert tok.is_word is True
    assert tok.is_ambiguous is False
    assert tok.romanization is None


def test_custom_factory_override_via_registry(monkeypatch):
    # This is the hook T-2.2 will use: drop-in a real Hindi pipeline without
    # touching main.py. Verify the dispatcher honors it.
    class MarkerPipeline(StubPipeline):
        pipeline_id = "marker"

    monkeypatch.setitem(pipelines._PIPELINE_FACTORIES, "stanza-hi", MarkerPipeline)
    pipelines.reset_pipeline_cache()
    assert isinstance(get_pipeline("hi"), MarkerPipeline)
