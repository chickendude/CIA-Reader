"""Shared output-shaping for Stanza UD-style pipelines.

Hindi (T-2.2) and Marathi (T-2.3) both run Stanza's UD pipeline and
produce the same :class:`Token` shape. The language-agnostic parts —
iterating over ``doc.sentences[*].words``, parsing UD ``feats`` into a
dict, applying the OOV / ``is_word`` POS heuristics — live here so one
subclass can't accidentally diverge from the other's contract.

Each concrete per-language class (``HindiPipeline``, ``MarathiPipeline``)
is a thin subclass that sets ``pipeline_id`` and is constructed with an
already-initialized stanza-like ``nlp`` object. The real model loading
happens in the corresponding ``build_<lang>_pipeline`` factory.
"""

from __future__ import annotations

import unicodedata
from typing import Any, Protocol

from app.numbers import number_forms as _compute_number_forms
from app.romanize import UnsupportedScriptError, to_roman
from app.schemas import LemmaCandidate, Token

from .base import Pipeline, PipelineResult


class StanzaLike(Protocol):
    """The subset of Stanza's ``Pipeline`` callable we depend on.

    Using a structural type lets tests inject a lightweight fake without
    importing stanza (and without having to install torch in CI). The
    production code path lazy-imports stanza in each ``build_*_pipeline``.
    """

    def __call__(self, text: str) -> Any: ...  # noqa: D401,E704


# UD UPOS tags where "lemma equals surface" does NOT imply OOV. A proper
# noun's lemma is its surface by design; punctuation / symbols / digits
# legitimately don't have dictionary lemmas; ``X`` is Stanza's other-
# language marker and is effectively a code-switch signal.
NON_OOV_UPOS: frozenset[str] = frozenset({"PUNCT", "SYM", "NUM", "PROPN", "X"})

# UD UPOS tags that aren't lexical words. The reader uses ``is_word`` to
# skip these when counting known-words and when rendering the pop-up.
NON_WORD_UPOS: frozenset[str] = frozenset({"PUNCT", "SYM"})

# Sentence-end punctuation that Stanza occasionally fails to split off
# the preceding word. The Hindi `hi_hdtb` model in particular leaves
# the danda glued when no whitespace separates them — common in
# user-generated Wikipedia / web text where a writer types
# "अवस्थिति।" rather than "अवस्थिति ।". Split-on-output keeps the
# popup pointed at a clean stem instead of an OOV "word + danda"
# blob the dictionary will never match. The marks are limited to
# end-of-sentence punctuation so we don't accidentally split numerals
# at decimals or comma-joined phrases.
_TRAILING_SPLIT_MARKS: tuple[str, ...] = ("।", "॥", "?", "!")

_SCRIPT_RANGES: dict[str, tuple[tuple[int, int], ...]] = {
    "Deva": ((0x0900, 0x097F),),
    "Orya": ((0x0B00, 0x0B7F),),
    # Hebrew block + Alphabetic Presentation Forms (ligature/pointed
    # variants that survive when input isn't NFC-normalized upstream).
    "Hebr": ((0x0590, 0x05FF), (0xFB1D, 0xFB4F)),
    # Basic Latin + Latin-1 Supplement + Latin Extended-A/B, covering
    # Basque's ç/ñ/ü and accented loanwords. Lets the foreign-script
    # filter in `should_treat_as_word` drop stray non-Latin fragments
    # (e.g. a Cyrillic or CJK quotation) from a Basque reader's word UX.
    "Latn": ((0x0041, 0x024F),),
}

_COORDINATE_MARKS: frozenset[str] = frozenset({"°", "′", "″"})


def _has_target_script(surface: str, script: str | None) -> bool:
    if not script:
        return True
    ranges = _SCRIPT_RANGES.get(script)
    if ranges is None:
        return True
    return any(
        start <= ord(ch) <= end
        for ch in surface
        for start, end in ranges
    )


def _has_letter(surface: str) -> bool:
    return any(unicodedata.category(ch).startswith("L") for ch in surface)


def _looks_like_coordinate_part(surface: str) -> bool:
    """Return True for coordinate / measurement fragments such as
    ``113°43`` or ``′6″W``.

    Stanza can split DMS coordinates in the middle and tag the numeric
    chunk as ``PROPN``. Those surfaces are not dictionary words and
    should not become clickable reader tokens; digit-only numbers still
    pass through so the number popup can handle them.
    """
    return any(mark in surface for mark in _COORDINATE_MARKS)


def should_treat_as_word(surface: str, upos: str, *, script: str | None) -> bool:
    """Return whether a token should participate in reader word UX.

    Stanza often tags English-only editorial fragments inside Indic
    articles as ``X`` or ``PROPN``. Those are useful for preserving text,
    but they should not become known-word entries or clickable dictionary
    tokens for a Hindi / Marathi / Odia reader. Numeric tokens are kept so
    the existing number-form popover still works for Latin or native digits.
    """
    if upos in NON_WORD_UPOS:
        return False
    if _looks_like_coordinate_part(surface):
        return False
    if upos == "NUM":
        return True
    if _has_letter(surface) and not _has_target_script(surface, script):
        return False
    return True


def _trailing_split_mark(surface: str) -> str | None:
    """Return the trailing sentence-end mark to peel off, or None.

    A surface that is *only* the mark (Stanza already split it
    correctly) is left alone; we only intervene when the mark is
    glued to a non-trivial preceding word. Multi-character marks
    aren't part of the current set, so a single character match
    is sufficient.
    """
    if len(surface) < 2:
        return None
    last = surface[-1]
    if last in _TRAILING_SPLIT_MARKS:
        return last
    return None


def parse_feats(feats: str | None) -> dict[str, str]:
    """Turn Stanza's ``"Tense=Pres|Number=Sing"`` string into a dict.

    Stanza uses ``None`` (or an empty string) when a word has no
    features. Malformed pairs are skipped rather than raising —
    morphology drift between Stanza model versions shouldn't 500 a
    ``/process`` call.
    """
    if not feats:
        return {}
    out: dict[str, str] = {}
    for pair in feats.split("|"):
        if "=" not in pair:
            continue
        key, _, value = pair.partition("=")
        key = key.strip()
        value = value.strip()
        if key:
            out[key] = value
    return out


class StanzaUDPipeline(Pipeline):
    """Base class that turns a Stanza doc into our :class:`Token` list.

    Two outputs the reader cares about that the raw Stanza word stream
    doesn't carry:

    * **Whitespace + paragraph tokens.** Stanza emits one Word per
      lexical token; nothing for the spaces between them. The reader
      needs `is_word=False` tokens for inter-word whitespace so the
      original layout (and paragraph breaks) renders. We use Stanza's
      `start_char` / `end_char` offsets to walk the gaps in the
      original input.
    * **Romanization.** When the registry hands us a `script` +
      `roman_scheme` (the per-language factory does this from the
      shared language descriptor), every word token gets the optional
      ISO-15919 / IAST / etc. layer the reader's "Show romanization"
      toggle wants.
    """

    pipeline_id: str

    def __init__(
        self,
        nlp: StanzaLike,
        *,
        script: str | None = None,
        roman_scheme: str | None = None,
        language: str | None = None,
    ) -> None:
        self._nlp = nlp
        self._script = script
        self._roman_scheme = roman_scheme
        # Optional registry language code ("hi", "mr", "or"). Forwarded
        # to ``to_roman`` so language-specific phonological rules
        # (currently just Hindi schwa deletion + ē/ō fold) fire when
        # the language hint is present. ``None`` keeps the legacy
        # script-only behavior — callers without language context
        # round-trip cleanly.
        self._language = language

    def process(self, text: str) -> PipelineResult:
        doc = self._nlp(text)
        tokens = list(self._tokens_from_doc(doc, text))
        return PipelineResult(pipeline_id=self.pipeline_id, tokens=tokens)

    def _tokens_from_doc(self, doc: Any, text: str) -> list[Token]:
        # Real Stanza Words always carry `start_char` / `end_char`;
        # synthetic Word fixtures in unit tests don't. Detect once
        # up-front so test fixtures still produce identical output
        # without manually adding offsets to every fake Word.
        has_offsets = self._doc_has_offsets(doc)
        tokens: list[Token] = []
        idx = 0
        cursor = 0
        for sentence in doc.sentences:
            for word in sentence.words:
                start = getattr(word, "start_char", None)
                end = getattr(word, "end_char", None)
                if has_offsets and start is not None and start > cursor:
                    gap = text[cursor:start]
                    if gap:
                        tokens.append(self._make_gap_token(idx, gap))
                        idx += 1
                surface = word.text
                # Split a trailing sentence-end mark off the surface
                # before the per-word Token shaping. Stanza's Hindi
                # tokenizer occasionally glues the danda to its
                # preceding word when there's no whitespace between
                # them, leaving the dictionary lookup with no chance
                # of matching. See `_TRAILING_SPLIT_MARKS`.
                trailing_mark = _trailing_split_mark(surface)
                lemma = word.lemma or surface
                if trailing_mark:
                    # Recompute lemma + surface for the word part. If
                    # Stanza's lemma was the glued form (the OOV
                    # fallback path), strip the same mark from it so
                    # downstream dictionary lookup sees a clean stem.
                    surface = surface[: -len(trailing_mark)]
                    if lemma.endswith(trailing_mark):
                        lemma = lemma[: -len(trailing_mark)]
                upos = (word.upos or "X").upper()
                features = parse_feats(word.feats)
                is_word = should_treat_as_word(
                    surface,
                    upos,
                    script=self._script,
                )
                is_oov = is_word and lemma == surface and upos not in NON_OOV_UPOS
                tokens.append(
                    Token(
                        idx=idx,
                        surface=surface,
                        is_word=is_word,
                        candidates=[
                            LemmaCandidate(
                                lemma=lemma,
                                pos=upos,
                                score=1.0,
                                features=features,
                            ),
                        ],
                        is_ambiguous=False,
                        is_oov=is_oov,
                        romanization=self._romanize(surface) if is_word else None,
                        number_forms=_compute_number_forms(surface),
                    )
                )
                idx += 1
                if trailing_mark:
                    # Emit the punctuation as its own Token so the
                    # reader paints it as a non-word boundary marker
                    # and the phrase-create logic refuses to span
                    # across sentence ends.
                    tokens.append(
                        Token(
                            idx=idx,
                            surface=trailing_mark,
                            is_word=False,
                            candidates=[
                                LemmaCandidate(
                                    lemma=trailing_mark,
                                    pos="PUNCT",
                                    score=1.0,
                                    features={},
                                ),
                            ],
                            is_ambiguous=False,
                            is_oov=False,
                            romanization=None,
                            number_forms=None,
                        )
                    )
                    idx += 1
                if has_offsets and end is not None:
                    cursor = end
        # Trailing whitespace after the last word — only when we
        # tracked offsets, otherwise the entire input would be
        # emitted as a fake "gap" after the words.
        if has_offsets and cursor < len(text):
            tail = text[cursor:]
            if tail:
                tokens.append(self._make_gap_token(idx, tail))
        return tokens

    @staticmethod
    def _doc_has_offsets(doc: Any) -> bool:
        for sentence in getattr(doc, "sentences", ()):
            for word in getattr(sentence, "words", ()):
                start = getattr(word, "start_char", None)
                end = getattr(word, "end_char", None)
                return start is not None and end is not None
        return False

    def _make_gap_token(self, idx: int, surface: str) -> Token:
        """Inter-word run of whitespace / punctuation Stanza didn't
        emit a Word for. Renders as plain text in the reader."""
        return Token(
            idx=idx,
            surface=surface,
            is_word=False,
            candidates=[],
            is_ambiguous=False,
            is_oov=False,
            romanization=None,
        )

    def _romanize(self, surface: str) -> str | None:
        if not self._script or not self._roman_scheme:
            return None
        try:
            return to_roman(
                surface,
                from_script=self._script,
                to_scheme=self._roman_scheme,
                language=self._language,
            )
        except UnsupportedScriptError:
            return None


__all__ = [
    "NON_OOV_UPOS",
    "NON_WORD_UPOS",
    "StanzaLike",
    "StanzaUDPipeline",
    "_trailing_split_mark",
    "parse_feats",
    "should_treat_as_word",
]
