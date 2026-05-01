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

    ``value`` carries the canonical Latin-digit string form so signed
    + decimal numerals round-trip losslessly (T-2.8a). ``"-3.14"``,
    ``"0.001"``, ``"123"`` are all valid; the integer part is bounded
    by ``10_000_000`` and the fractional part may be arbitrarily long.
    """

    value: str
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


class ProposedPhrase(BaseModel):
    """One rule-based phrase proposal (T-14.5).

    Emitted by the per-language ``PhraseDetector`` after Stanza
    finishes its pass — a contiguous run of token indices that
    matches a YAML pattern (e.g. ``NOUN + करना`` for Hindi conjunct
    verbs). The web worker (T-14.5a) writes proposals to a queue
    and promotes them to ``phrases`` (``source='nlp'``) once they
    cross the per-chapter occurrence threshold.

    ``pattern_id`` is the stable ``id`` field from the matched YAML
    rule so curators can audit which patterns are pulling their
    weight; ``surfaces`` is the ordered token surfaces (NFC-
    normalised on the Python side so the worker doesn't have to
    re-derive ``surface_normalised`` for the dedupe lookup).
    """

    start_idx: int = Field(..., description="Index of the first matched token (inclusive).")
    end_idx: int = Field(..., description="Index of the last matched token (inclusive).")
    pattern_id: str = Field(..., description="YAML rule id that matched.")
    surfaces: list[str] = Field(
        ...,
        description="Ordered token surfaces in the matched run, NFC-normalised.",
    )


class ProcessResponse(BaseModel):
    language: str
    pipeline_id: str
    tokens: list[Token]
    proposed_phrases: list[ProposedPhrase] = Field(
        default_factory=list,
        description="T-14.5: rule-based phrase proposals over the token list.",
    )
