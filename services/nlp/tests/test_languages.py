from __future__ import annotations

from app.languages import (
    LANGUAGES,
    SUPPORTED_LANGUAGE_CODES,
    get_language,
    is_supported_language,
)


def test_every_declared_code_is_exported():
    assert set(SUPPORTED_LANGUAGE_CODES) == set(LANGUAGES.keys())


def test_every_descriptor_matches_its_map_key():
    for code, descriptor in LANGUAGES.items():
        assert descriptor.code == code


def test_mvp_languages_have_expected_scripts():
    assert LANGUAGES["hi"].script == "Deva"
    assert LANGUAGES["mr"].script == "Deva"
    # Odia uses Odia script, not Devanagari. This is the script-agnostic check.
    assert LANGUAGES["or"].script == "Orya"
    # Yiddish is the first non-Brahmic, right-to-left language.
    assert LANGUAGES["yi"].script == "Hebr"
    assert LANGUAGES["yi"].text_direction == "rtl"
    assert LANGUAGES["yi"].pipeline_id == "custom-yi"
    assert LANGUAGES["yi"].default_romanization == "yivo"


def test_every_descriptor_has_at_least_one_font_and_romanization():
    for descriptor in LANGUAGES.values():
        assert descriptor.recommended_fonts, descriptor.code
        assert descriptor.supported_romanizations, descriptor.code
        assert descriptor.default_romanization in descriptor.supported_romanizations


def test_get_language_returns_descriptor():
    assert get_language("hi").display_name == "Hindi"


def test_is_supported_language():
    assert is_supported_language("hi") is True
    assert is_supported_language("xx") is False
