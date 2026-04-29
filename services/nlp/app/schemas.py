from __future__ import annotations

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str
    languages: list[str]


class ProcessRequest(BaseModel):
    language: str = Field(..., description="ISO 639-1 language code (e.g. 'hi', 'mr', 'or').")
    text: str = Field(..., min_length=1)


class LemmaCandidate(BaseModel):
    lemma: str
    pos: str
    score: float
    features: dict[str, str] = Field(default_factory=dict)


class NumberLanguageForm(BaseModel):
    """Per-language number rendering: native-script spelled-out form
    plus its ISO 15919 romanization. Surfaced by :mod:`app.numbers` for
    digit-only NUM tokens (T-2.8)."""

    spelled: str
    romanized: str


class NumberForms(BaseModel):
    """Per-token number-form payload for digit-only NUM surfaces. The
    reader pop-up uses this to show the spelled-out form in all three
    MVP languages so a learner can sound out a numeral without leaving
    the page (T-2.8). ``None`` on the parent :class:`Token` for any
    token that isn't a single-script digit run in ``[0, 10_000_000]``.
    """

    value: int
    digits_latin: str
    digits_deva: str
    digits_orya: str
    hi: NumberLanguageForm
    mr: NumberLanguageForm
    # The wire field uses ``odia`` instead of the ISO 639-1 code
    # ``or`` because ``or`` is a reserved Python keyword and can't be
    # an attribute name. The TypeScript mirror in
    # ``apps/web/src/lib/server/nlp-client.ts`` matches.
    odia: NumberLanguageForm


class Token(BaseModel):
    idx: int
    surface: str
    is_word: bool
    candidates: list[LemmaCandidate] = Field(default_factory=list)
    is_ambiguous: bool = False
    is_oov: bool = False
    romanization: str | None = None
    number_forms: NumberForms | None = None


class ProcessResponse(BaseModel):
    language: str
    pipeline_id: str
    tokens: list[Token]
