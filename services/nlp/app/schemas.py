from __future__ import annotations

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str
    languages: list[str]


class ProcessRequest(BaseModel):
    language: str = Field(..., description="ISO 639-1 language code (e.g. 'hi', 'mr', 'or').")
    text: str = Field(..., min_length=1)


class RomanizeRequest(BaseModel):
    """Batch romanization request — feeds the curator form-editor's
    "regenerate forms from paradigm" action so generated surfaces land
    with their canonical (language-default scheme) romanization
    pre-filled. Avoids spinning up a one-token /process call per slot.
    """

    language: str = Field(..., description="ISO 639-1 language code.")
    surfaces: list[str] = Field(
        ..., description="Native-script surfaces to romanize, in caller order.",
    )


class RomanizeResponse(BaseModel):
    """One romanization per input surface, in the same order. ``None``
    entries indicate the surface couldn't be transliterated (empty
    string, unsupported script, etc.) — the caller leaves the row's
    romanization NULL in those cases."""

    romanizations: list[str | None]


class LemmaCandidate(BaseModel):
    lemma: str
    pos: str
    score: float
    features: dict[str, str] = Field(default_factory=dict)
    dictionary_id: str | None = None


class NumberLanguageForm(BaseModel):
    """Per-language number rendering: native-script spelled-out form
    plus its ISO 15919 romanization. Surfaced by :mod:`app.numbers` for
    digit-only NUM tokens."""

    spelled: str
    romanized: str


class NumberForms(BaseModel):
    """Preserve the number as a string of digits so signs and decimals survive conversion. The
    reader also receives the spellings and readings it can display."""

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
    # Basque (Euskara). Latin script needs no transliteration, so the
    # ``romanized`` field is the empty string — the spelled-out form is
    # already the reading. Basque numerals are base-20 (vigesimal); see
    # :func:`app.numbers.to_words_eu`.
    eu: NumberLanguageForm


class Token(BaseModel):
    idx: int
    sentence_idx: int = 0
    surface: str
    is_word: bool
    candidates: list[LemmaCandidate] = Field(default_factory=list)
    is_ambiguous: bool = False
    is_oov: bool = False
    romanization: str | None = None
    number_forms: NumberForms | None = None


class ProposedPhrase(BaseModel):
    """One rule-based phrase proposal.

    Emitted by the per-language ``PhraseDetector`` after Stanza
    finishes its pass — a contiguous run of token indices that
    matches a YAML pattern (e.g. ``NOUN + करना`` for Hindi conjunct
    verbs). The web worker writes proposals to a queue
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
    hindi_analysis: dict | None = None
    proposed_phrases: list[ProposedPhrase] = Field(
        default_factory=list,
        description="Phrases that matched the language's patterns in this token list.",
    )


class BBox(BaseModel):
    """A word's bounding box on a PDF page image, normalized to 0..1 of
    the page width/height. Resolution-independent so the reader overlay
    scales to whatever size the image renders at."""

    x: float
    y: float
    w: float
    h: float


class OcrToken(Token):
    """A :class:`Token` plus the page-image bounding box the word
    occupies. ``bbox`` is ``None`` for whitespace/punctuation tokens and
    for any word the aligner couldn't locate on the page."""

    bbox: BBox | None = None


class OcrResponse(BaseModel):
    """Result of OCR-ing one PDF page image.

    Mirrors :class:`ProcessResponse` (same tokens + phrase proposals so
    the web side reuses its lemma-resolution/persist path unchanged) and
    adds the reconstructed page ``body`` text, the page image pixel
    dimensions, and a per-token ``bbox``.
    """

    language: str
    pipeline_id: str
    width: int
    height: int
    body: str
    tokens: list[OcrToken]
    hindi_analysis: dict | None = None
    proposed_phrases: list[ProposedPhrase] = Field(default_factory=list)
