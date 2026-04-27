"""ISO 15919 romanization for hi / mr / or via aksharamukha.

The registry only declares one scheme (`iso15919`), so this module returns
that. Aksharamukha does the heavy lifting; we add two language-specific knobs:

  * Hindi gets aggressive schwa deletion (`RemoveSchwaHindi` pre_option), so
    राम → "rām" (not "rāma") and कमल → "kamal" (not "kamala"). Marathi and
    Odia retain the inherent schwa, which matches their actual pronunciation.

  * Hindi output is post-processed to fold ē→e and ō→o. ISO 15919 emits
    macrons because Devanagari े and ो are *historically* long, but Hindi
    has merged the length distinction — only one /e/ and one /o/ phoneme.
    Marathi and Odia keep the macrons because they still distinguish length.
"""

from __future__ import annotations

from aksharamukha import transliterate

from app.languages import LanguageCode, is_supported_language

_SRC_SCRIPT: dict[LanguageCode, str] = {
    "hi": "Devanagari",
    "mr": "Devanagari",
    "or": "Oriya",
}

_PRE_OPTIONS: dict[LanguageCode, list[str]] = {
    "hi": ["RemoveSchwaHindi"],
    "mr": [],
    "or": [],
}

_HINDI_VOWEL_FOLDS = str.maketrans({"ē": "e", "Ē": "E", "ō": "o", "Ō": "O"})


def romanize(language: str, text: str) -> str:
    if not is_supported_language(language):
        raise ValueError(f"Unsupported language: {language!r}")

    lang: LanguageCode = language  # type: ignore[assignment]
    out = transliterate.process(
        _SRC_SCRIPT[lang],
        "ISO",
        text,
        pre_options=_PRE_OPTIONS[lang],
    )
    if lang == "hi":
        out = out.translate(_HINDI_VOWEL_FOLDS)
    return out
