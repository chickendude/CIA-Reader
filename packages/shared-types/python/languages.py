"""
Language registry — Python mirror of packages/shared-types/src/languages.ts.

Kept byte-for-byte in lockstep with the TS source. When adding a language,
update both files in the same PR. A CI check in M0 diffs the two.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

LanguageCode = Literal["hi", "mr", "or", "yi"]
ScriptCode = Literal["Deva", "Orya", "Beng", "Guru", "Gujr", "Arab", "Hebr"]
RomanizationScheme = Literal["iso15919", "iast", "hunterian", "itrans", "velthuis", "yivo"]
TextDirection = Literal["ltr", "rtl"]


@dataclass(frozen=True)
class LanguageDescriptor:
    code: LanguageCode
    display_name: str
    native_name: str
    script: ScriptCode
    text_direction: TextDirection
    supported_romanizations: tuple[RomanizationScheme, ...]
    default_romanization: RomanizationScheme
    recommended_fonts: tuple[str, ...]
    pipeline_id: str
    notes: str | None = field(default=None)


LANGUAGES: dict[LanguageCode, LanguageDescriptor] = {
    "hi": LanguageDescriptor(
        code="hi",
        display_name="Hindi",
        native_name="हिन्दी",
        script="Deva",
        text_direction="ltr",
        supported_romanizations=("iso15919", "iast", "hunterian", "itrans"),
        default_romanization="iso15919",
        recommended_fonts=(
            "Noto Serif Devanagari",
            "Noto Sans Devanagari",
            "Tiro Devanagari Hindi",
            "Mukta",
        ),
        pipeline_id="stanza-hi",
    ),
    "mr": LanguageDescriptor(
        code="mr",
        display_name="Marathi",
        native_name="मराठी",
        script="Deva",
        text_direction="ltr",
        supported_romanizations=("iso15919", "iast", "hunterian", "itrans"),
        default_romanization="iso15919",
        recommended_fonts=(
            "Noto Serif Devanagari",
            "Noto Sans Devanagari",
            "Tiro Devanagari Marathi",
            "Mukta",
        ),
        pipeline_id="stanza-mr",
    ),
    "or": LanguageDescriptor(
        code="or",
        display_name="Odia",
        native_name="ଓଡ଼ିଆ",
        script="Orya",
        text_direction="ltr",
        supported_romanizations=("iso15919", "iast", "itrans"),
        default_romanization="iso15919",
        recommended_fonts=("Noto Sans Oriya", "Noto Serif Oriya", "Lohit Odia"),
        pipeline_id="custom-or",
        notes=(
            "Stanza's Odia support is weak. We ship a custom pipeline "
            "(IndicNLP tokenizer + rule-based morphological analyzer seeded "
            "from Odia WordNet)."
        ),
    ),
    "yi": LanguageDescriptor(
        code="yi",
        display_name="Yiddish",
        native_name="ייִדיש",
        script="Hebr",
        text_direction="rtl",
        supported_romanizations=("yivo",),
        default_romanization="yivo",
        recommended_fonts=(
            "Noto Serif Hebrew",
            "Noto Sans Hebrew",
            "David Libre",
            "Frank Ruhl Libre",
        ),
        pipeline_id="custom-yi",
        notes=(
            "No Stanza model exists for Yiddish. We ship a custom pipeline "
            "(Hebrew-script tokenizer + rule-based morphological analyzer "
            "over a seed lemma table), mirroring the Odia approach. First "
            "RTL language — UI direction comes from text_direction."
        ),
    ),
}

SUPPORTED_LANGUAGE_CODES: tuple[LanguageCode, ...] = tuple(LANGUAGES.keys())


def get_language(code: LanguageCode) -> LanguageDescriptor:
    return LANGUAGES[code]


def is_supported_language(value: str) -> bool:
    return value in LANGUAGES
