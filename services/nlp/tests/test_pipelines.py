"""Tests for the pipeline dispatch layer (T-2.1).

These tests isolate the dispatch behavior from the HTTP layer — they go
directly against :mod:`app.pipelines` so regressions show up with a
pinpointed stack trace, not a FastAPI 500.
"""

from __future__ import annotations

import pytest

from app import pipelines
from app.pipelines import Pipeline, PipelineResult, StubPipeline, get_pipeline
from app.pipelines.hindi import HindiPipeline
from app.pipelines.marathi import MarathiPipeline
from app.pipelines.odia import OdiaPipeline
from app.schemas import LemmaCandidate, Token


@pytest.fixture(autouse=True)
def _clear_cache():
    pipelines.reset_pipeline_cache()
    yield
    pipelines.reset_pipeline_cache()


def test_get_pipeline_returns_real_pipelines_for_mvp_languages():
    # After T-2.2 / T-2.3 / T-2.3a, every MVP language routes to its
    # real implementation. No language is on the stub any more (the
    # StubPipeline still exists as a test-only factory override target).
    assert isinstance(get_pipeline("hi"), HindiPipeline)
    assert isinstance(get_pipeline("mr"), MarathiPipeline)
    assert isinstance(get_pipeline("or"), OdiaPipeline)
    for code in ("hi", "mr", "or"):
        pipe = get_pipeline(code)
        assert isinstance(pipe, Pipeline)
        assert not isinstance(pipe, StubPipeline)


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


def test_stub_pipeline_emits_alternating_word_and_whitespace_tokens():
    """The reader's per-token renderer wants the original whitespace
    preserved as its own non-word token (so spaces and paragraph
    breaks survive). The stub used to drop whitespace via
    ``str.split``; now it walks runs and emits alternating word /
    non-word tokens."""
    out = StubPipeline().process("नमस्ते दुनिया")
    assert isinstance(out, PipelineResult)
    surfaces = [t.surface for t in out.tokens]
    assert surfaces == ["नमस्ते", " ", "दुनिया"]
    word_tokens = [t for t in out.tokens if t.is_word]
    space_tokens = [t for t in out.tokens if not t.is_word]
    assert len(word_tokens) == 2
    assert len(space_tokens) == 1
    assert all(t.is_oov for t in word_tokens), "stub must mark every word OOV"
    assert all(len(t.candidates) == 1 for t in word_tokens)
    assert space_tokens[0].candidates == []
    assert isinstance(word_tokens[0].candidates[0], LemmaCandidate)


def test_stub_pipeline_emits_romanization_when_script_known():
    """When the registry hands the stub a script + scheme (the
    per-language stubs in ``app.pipelines`` do, since the registry
    knows Hindi → Deva → ISO 15919), every word token carries a
    romanization. Bare ``StubPipeline()`` (used in unit tests) keeps
    romanization None."""
    bare = StubPipeline().process("नमस्ते")
    assert bare.tokens[0].romanization is None

    with_script = StubPipeline(script="Deva", roman_scheme="iso15919")
    out = with_script.process("नमस्ते दुनिया")
    word_tokens = [t for t in out.tokens if t.is_word]
    assert word_tokens[0].romanization is not None
    assert word_tokens[1].romanization is not None
    # Spaces never get a romanization.
    space_tokens = [t for t in out.tokens if not t.is_word]
    assert space_tokens[0].romanization is None


def test_stub_pipeline_ignores_latin_only_words_when_script_known():
    out = StubPipeline(script="Deva", roman_scheme="iso15919").process("Edit this नमस्ते")
    assert [t.surface for t in out.tokens] == ["Edit", " ", "this", " ", "नमस्ते"]
    assert [t.is_word for t in out.tokens] == [False, False, False, False, True]
    assert [t.is_oov for t in out.tokens] == [False, False, False, False, True]


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


# ----------------------------------------------------------------
# T-2.8: digit-only NUM tokens carry number_forms across all three
# pipelines, regardless of source script.
# ----------------------------------------------------------------


def _find_number_token(tokens: list[Token], surface: str) -> Token | None:
    for t in tokens:
        if t.surface == surface:
            return t
    return None


@pytest.mark.parametrize(
    "language,text,number_surface",
    [
        ("hi", "वर्ष 2024 में", "2024"),
        ("hi", "साल १२३ का", "१२३"),
        ("mr", "वर्ष 2024 ला", "2024"),
        ("or", "ବର୍ଷ 2024 ରେ", "2024"),
        ("or", "ବର୍ଷ ୧୨୩ ରେ", "୧୨୩"),
    ],
)
def test_pipeline_attaches_number_forms_for_digit_tokens(
    language: str, text: str, number_surface: str
) -> None:
    pipe = get_pipeline(language)
    out = pipe.process(text)
    tok = _find_number_token(out.tokens, number_surface)
    assert tok is not None, f"no token with surface {number_surface!r} in {out.tokens}"
    assert tok.number_forms is not None
    # value matches the digit run regardless of source script
    expected_value = int(number_surface) if number_surface.isascii() else None
    if expected_value is not None:
        assert tok.number_forms.value == expected_value
    # All three language renderings populated.
    assert tok.number_forms.hi.spelled
    assert tok.number_forms.hi.romanized
    assert tok.number_forms.mr.spelled
    assert tok.number_forms.odia.spelled


def test_pipeline_no_number_forms_on_mixed_script_digits() -> None:
    """A surface like ``१2३`` (Devanagari + Latin mix) parses to a
    single token under the whitespace fake but is not a single-script
    digit run, so number_forms must be None."""
    pipe = get_pipeline("hi")
    out = pipe.process("कुछ १2३ है")
    tok = _find_number_token(out.tokens, "१2३")
    assert tok is not None
    assert tok.number_forms is None


def test_pipeline_no_number_forms_on_words() -> None:
    pipe = get_pipeline("hi")
    out = pipe.process("नमस्ते दुनिया")
    for t in out.tokens:
        assert t.number_forms is None
