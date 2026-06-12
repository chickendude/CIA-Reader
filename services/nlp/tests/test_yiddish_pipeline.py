"""Yiddish pipeline tests.

The Yiddish pipeline has no external model or tokenizer dependency, so
unlike Hindi/Marathi these tests run the production configuration
(`build_yiddish_pipeline`) directly.
"""

from __future__ import annotations

from app.pipelines import get_pipeline, reset_pipeline_cache
from app.pipelines.yiddish import (
    YiddishPipeline,
    build_yiddish_pipeline,
    yiddish_tokenize,
)


def _pipeline() -> YiddishPipeline:
    return build_yiddish_pipeline()


# ---- tokenizer ----


def test_tokenizer_splits_words_and_punctuation():
    assert yiddish_tokenize("איך שרײַב.") == ["איך", "שרײַב", "."]


def test_tokenizer_keeps_pointed_letters_inside_words():
    # Pasekh / komets / rafe etc. are combining marks and must not
    # split a word.
    assert yiddish_tokenize("װאַסער") == ["װאַסער"]
    assert yiddish_tokenize("פֿרײַנד") == ["פֿרײַנד"]


def test_tokenizer_keeps_latin_and_digit_runs_whole():
    assert yiddish_tokenize("זײַט 25 yards") == ["זײַט", "25", "yards"]


def test_tokenizer_hebrew_punctuation():
    # Gershayim-style abbreviations split at the mark — acceptable at
    # MVP; the pieces stay adjacent thanks to the gap walk.
    assert yiddish_tokenize("״צוויי״") == ["״", "צוויי", "״"]


# ---- token shaping ----


def test_whitespace_gaps_are_preserved():
    result = _pipeline().process("איך בין דאָ")
    surfaces = [t.surface for t in result.tokens]
    assert surfaces == ["איך", " ", "בין", " ", "דאָ"]
    gap = result.tokens[1]
    assert gap.is_word is False
    assert gap.candidates == []


def test_paragraph_breaks_survive_as_gap_tokens():
    result = _pipeline().process("איך בין דאָ\n\nדו ביסט דאָ")
    gaps = [t.surface for t in result.tokens if not t.is_word and not t.candidates]
    assert "\n\n" in gaps


def test_punctuation_token_shape():
    result = _pipeline().process("איך בין דאָ.")
    dot = result.tokens[-1]
    assert dot.surface == "."
    assert dot.is_word is False
    assert dot.candidates[0].pos == "PUNCT"


def test_oov_word_gets_surface_fallback_candidate():
    result = _pipeline().process("קאָמפּיוטער")
    token = result.tokens[0]
    assert token.is_word is True
    assert token.is_oov is True
    assert token.candidates[0].lemma == "קאָמפּיוטער"
    assert token.candidates[0].pos == "X"


def test_latin_fragment_is_not_a_reader_word():
    # Code-switched editorial fragments shouldn't become clickable
    # dictionary tokens for a Yiddish reader — same heuristic as the
    # Indic pipelines, driven by the Hebr script ranges.
    result = _pipeline().process("hello איך")
    latin = result.tokens[0]
    assert latin.surface == "hello"
    assert latin.is_word is False
    assert latin.is_oov is False


def test_word_tokens_carry_yivo_romanization():
    result = _pipeline().process("בוך")
    assert result.tokens[0].romanization == "bukh"


def test_number_forms_deliberately_absent():
    # NumberForms spells numerals in Hindi/Marathi/Odia — meaningless
    # in a Yiddish reader, so the pipeline leaves the field None.
    result = _pipeline().process("25 ביכער")
    num = result.tokens[0]
    assert num.number_forms is None


def test_ambiguous_infinitive_sets_flag():
    result = _pipeline().process("זינגען")
    token = result.tokens[0]
    assert token.is_ambiguous is True
    assert {c.lemma for c in token.candidates} == {"זינגען"}
    assert len(token.candidates) == 2


def test_uniform_candidate_scores():
    result = _pipeline().process("זינגען")
    scores = [c.score for c in result.tokens[0].candidates]
    assert all(s == 0.5 for s in scores)


# ---- dispatch ----


def test_registry_dispatches_custom_yi():
    reset_pipeline_cache()
    pipeline = get_pipeline("yi")
    assert pipeline.pipeline_id == "custom-yi"
    assert isinstance(pipeline, YiddishPipeline)
