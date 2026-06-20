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
    # Basque is the first Latin-script language: Stanza-backed, ltr, and
    # with no romanization layer (the text is already Latin).
    assert LANGUAGES["eu"].script == "Latn"
    assert LANGUAGES["eu"].text_direction == "ltr"
    assert LANGUAGES["eu"].pipeline_id == "stanza-eu"
    assert LANGUAGES["eu"].supported_romanizations == ()
    assert LANGUAGES["eu"].default_romanization is None


def test_every_descriptor_has_at_least_one_font():
    for descriptor in LANGUAGES.values():
        assert descriptor.recommended_fonts, descriptor.code


def test_romanization_defaults_match_supported_list():
    for descriptor in LANGUAGES.values():
        if descriptor.supported_romanizations:
            assert (
                descriptor.default_romanization in descriptor.supported_romanizations
            ), descriptor.code
        else:
            # Latin-script languages (Basque) declare no romanization layer.
            assert descriptor.default_romanization is None, descriptor.code


def test_get_language_returns_descriptor():
    assert get_language("hi").display_name == "Hindi"


def test_is_supported_language():
    assert is_supported_language("hi") is True
    assert is_supported_language("xx") is False
