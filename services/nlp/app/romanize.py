"""Romanization + transliteration utilities (T-2.5).

Thin, typed wrapper over ``indic-transliteration``'s ``sanscript`` —
bidirectional conversion between a language's native script and a
romanization scheme, driven by the shared language registry so no
caller hardcodes "Devanagari."

Two directions:

* :func:`to_roman` — produces the optional romanization layer the
  reader shows above each word (precomputed at token-processing time
  and stored on ``text_tokens``; cheap reads at render time).
* :func:`to_native` — used by the script-aware input component
  (T-6.2a) to convert keystrokes / pasted text back into the native
  script for dictionary search and correction submissions. The
  client-side mirror of this uses ``sanscript.js`` so keystrokes are
  instant; this server-side copy is used in places where we need a
  single canonical conversion (e.g. batch correction tools).

Supported scripts at MVP: ``Deva`` (Hindi, Marathi), ``Orya`` (Odia).
Supported schemes: ``iso15919``, ``iast``, ``itrans``, ``velthuis``.
Hunterian is declared in the language registry but intentionally not
implemented here — ``sanscript`` doesn't ship a Hunterian scheme, and
a faithful implementation needs a custom mapping table that will
land in a follow-up ticket (see docstring on :data:`SUPPORTED_SCHEMES`).

Script + scheme tokens are the registry's canonical codes (ISO 15924
script + the ``RomanizationScheme`` Literal). Calling code never
touches ``sanscript``'s internal names.

Hindi schwa deletion
====================

Hindi drops the Devanagari inherent schwa in most positions
(राम → ``rām``, कमल → ``kamal``, भारत → ``bhārat``), and the schemes
sanscript ships from a Sanskrit baseline don't model that — sanscript
alone produces ``rāma``, ``kamala``, ``bhārata``. Marathi and Odia
retain the schwa, so the bug is Hindi-specific.

When :func:`to_roman` is called with ``language="hi"`` we route the
Devanagari input through aksharamukha's ``RemoveSchwaHindi`` pre-rule,
which emits the same Devanagari with explicit viramas where the schwa
should be silent (e.g. कमला → कम्ला). That schwa-deleted Devanagari is
then handed to sanscript like any other input, so every supported
scheme (ISO / IAST / ITRANS / Velthuis) picks up the deletion
uniformly — we don't depend on aksharamukha's romanization output.

A second Hindi-specific quirk: ISO 15919 distinguishes ``ē/ō`` (long)
from ``e/o`` (short). Hindi merged that distinction phonologically —
there is only one /e/ and one /o/ — but sanscript still emits
``ē/ō`` because the underlying Devanagari े/ो are mechanically the
"long" forms. For ``language="hi"`` + ``to_scheme="iso15919"`` we
fold ``ē → e`` and ``ō → o`` after transliteration so the output
matches reader expectations. Marathi and Odia keep the macrons — they
genuinely use the length distinction.

The ``language`` kwarg is opt-in. Callers without language context
(round-trip dictionary tooling, the script-aware editor's reverse
``to_native`` direction) keep getting raw sanscript output, which
is reversible. Schwa-deleted Hindi output is intentionally lossy —
``rām`` doesn't round-trip back to राम — so it's display-only.
"""

from __future__ import annotations

import re
import unicodedata

from aksharamukha import transliterate as _aksharamukha
from indic_transliteration import sanscript

# Script codes (ISO 15924) → the sanscript scheme name. The registry
# ships more script codes than we implement right now (Beng, Guru,
# Gujr are future languages); they're pre-wired here so adding a new
# language in M14 is a one-line registry change, not a romanize.py
# refactor. ``Arab`` (Urdu / Sindhi Perso-Arabic) is deliberately
# omitted — that lands with M15 and needs its own mapping pass.
_SCRIPT_TO_SANSCRIPT: dict[str, str] = {
    "Deva": sanscript.DEVANAGARI,
    "Orya": sanscript.ORIYA,
    "Beng": sanscript.BENGALI,
    "Guru": sanscript.GURMUKHI,
    "Gujr": sanscript.GUJARATI,
}


# Romanization scheme (our registry names) → sanscript scheme name.
# Hunterian is in the registry's supported_romanizations for Hindi /
# Marathi but not implemented here — sanscript has no Hunterian scheme
# and the Hunterian transliteration table is its own project. Users
# who pick "hunterian" in their profile today see a validation error
# from :func:`to_roman` / :func:`to_native`; the web layer catches
# this and falls back to iso15919 for display. Follow-up: build a
# native Hunterian table alongside the rest when M2 is closed out.
_SCHEME_TO_SANSCRIPT: dict[str, str] = {
    "iso15919": sanscript.ISO,
    "iast": sanscript.IAST,
    "itrans": sanscript.ITRANS,
    "velthuis": sanscript.VELTHUIS,
}


#: Read-only view of the romanization schemes this module actually
#: converts. Used by validation at the API layer so the user profile
#: UI never offers an option that would fail at runtime.
SUPPORTED_SCHEMES: frozenset[str] = frozenset(_SCHEME_TO_SANSCRIPT.keys())

#: Read-only view of the scripts this module converts.
SUPPORTED_SCRIPTS: frozenset[str] = frozenset(_SCRIPT_TO_SANSCRIPT.keys())


class UnsupportedScriptError(ValueError):
    """Raised when a script code isn't in :data:`SUPPORTED_SCRIPTS`."""


class UnsupportedSchemeError(ValueError):
    """Raised when a romanization scheme isn't in :data:`SUPPORTED_SCHEMES`.

    Hunterian is declared by the registry but not implemented here;
    callers see this error with a message explaining the fallback.
    """


def _resolve_script(code: str) -> str:
    try:
        return _SCRIPT_TO_SANSCRIPT[code]
    except KeyError as e:
        raise UnsupportedScriptError(
            f"Romanization not implemented for script {code!r}; "
            f"supported: {sorted(SUPPORTED_SCRIPTS)}"
        ) from e


def _resolve_scheme(name: str) -> str:
    try:
        return _SCHEME_TO_SANSCRIPT[name]
    except KeyError as e:
        raise UnsupportedSchemeError(
            f"Romanization scheme {name!r} not implemented; supported: {sorted(SUPPORTED_SCHEMES)}"
        ) from e


# Word scanner used by :func:`_patch_nukta_final_virama`. The character
# class lists every Devanagari codepoint that can occur *inside* a Hindi
# word (consonants, vowel letters, vowel signs, virama, nukta, anusvara,
# vocalic R/L letters and signs, Vedic accent marks). Punctuation
# (danda U+0964, double-danda U+0965), the abbreviation sign U+0970, and
# Devanagari digits U+0966-U+096F are deliberately excluded so they act
# as word boundaries.
_DEVA_WORD_RE = re.compile(
    "[ँ-ःऄ-औक-हऺ-ॏ"
    "॑-॔क़-य़ॠ-ॣ]+"
)
# A word-final nukta-bearing consonant: either a precomposed atomic
# letter (U+0958-U+095F covers क़ख़ग़ज़ड़ढ़फ़य़, plus U+0931 ऱ) or a
# base consonant followed by an explicit nukta U+093C.
_NUKTA_CONS_AT_END = re.compile(
    r"(?:[क़-य़ऱ]|[क-ह]़)$"
)
# Multi-syllable detector: any consonant or full vowel letter sitting
# before our final nukta consonant means the word has at least two
# syllables, so the final inherent schwa should drop. Single-syllable
# forms (just `फ़`, just `क`) keep their schwa, matching aksharamukha's
# own behavior for non-nukta minimal forms.
_HAS_PRIOR_SYLLABLE = re.compile(
    r"[ऄ-औक-हक़-य़ऱॠॡ]"
)


def _patch_nukta_final_virama(text: str) -> str:
    """Append a virama after word-final nukta-bearing consonants.

    aksharamukha's ``RemoveSchwaHindi`` pre-rule fails to virama-mark
    the final inherent schwa when a word ends in a nukta-bearing
    consonant — most reliably when that consonant is preceded by a
    half-consonant. So बर्फ़ comes back unchanged from aksharamukha and
    sanscript reads the trailing schwa as a real vowel: ``barfa``
    instead of ``barf``. This pass closes the gap by scanning each
    Devanagari word and appending a virama at the tail when the word
    ends in a nukta consonant and is multi-syllable. Word-medial nukta
    consonants (the medial फ़ in बर्फ़ानी, the ज़ in दर्ज़ी) and
    single-syllable forms (standalone फ़) are left alone.
    """

    def _fix(m: re.Match[str]) -> str:
        word = m.group(0)
        tail = _NUKTA_CONS_AT_END.search(word)
        if tail is None:
            return word
        if _HAS_PRIOR_SYLLABLE.search(word[: tail.start()]) is None:
            return word
        return word + "्"

    return _DEVA_WORD_RE.sub(_fix, text)


def _hindi_schwa_delete(devanagari: str) -> str:
    """Apply aksharamukha's ``RemoveSchwaHindi`` to a Devanagari string.

    Returns the same string with explicit viramas where the inherent
    schwa should be silent. This is a Devanagari→Devanagari transform —
    the actual romanization is still done by sanscript. Wrapped behind
    a function so callers (and tests) don't import aksharamukha
    directly and so the dependency is easy to swap if a better Hindi
    schwa-deletion model lands later.

    Followed by :func:`_patch_nukta_final_virama` to compensate for an
    aksharamukha gap on word-final nukta-bearing consonants.
    """
    out = _aksharamukha.process(
        "Devanagari",
        "Devanagari",
        devanagari,
        pre_options=["RemoveSchwaHindi"],
    )
    return _patch_nukta_final_virama(out)


# Hindi merges the ISO 15919 ē/ō length distinction into a single
# /e/ and /o/. After sanscript emits ISO output we fold the macron
# variants down to plain e/o for the Hindi display layer. Marathi and
# Odia genuinely use the length distinction and skip this fold.
_HINDI_ISO_FOLD = str.maketrans({"ē": "e", "ō": "o", "Ē": "E", "Ō": "O"})


def to_roman(
    text: str,
    *,
    from_script: str,
    to_scheme: str,
    language: str | None = None,
) -> str:
    """Transliterate native-script text into a romanization scheme.

    The input is NFC-normalized defensively — the /process HTTP layer
    already does this globally, but the batch correction worker and
    dictionary-import code call this module directly, and a
    mis-normalized surface shouldn't produce a mis-romanized output.
    Empty string in, empty string out — a no-op rather than an error.

    ``language`` is an opt-in hint that lets callers trigger
    language-specific phonological rules — currently just Hindi schwa
    deletion + ISO ē/ō → e/o fold (see module docstring). Pass the
    registry's language code (``"hi"``, ``"mr"``, ``"or"``) when the
    output is for *display*; leave it unset when the output must
    round-trip back through :func:`to_native`.
    """
    if not text:
        return ""
    normalized = unicodedata.normalize("NFC", text)
    if language == "hi" and from_script == "Deva":
        # Schwa-delete on the Devanagari side, then let sanscript handle
        # the actual romanization for whichever scheme was requested.
        normalized = _hindi_schwa_delete(normalized)
    src = _resolve_script(from_script)
    dst = _resolve_scheme(to_scheme)
    out = sanscript.transliterate(normalized, src, dst)
    if language == "hi" and to_scheme == "iso15919":
        out = out.translate(_HINDI_ISO_FOLD)
    return out


def to_native(text: str, *, target_script: str, from_scheme: str) -> str:
    """Transliterate romanized text into a target native script.

    The inverse of :func:`to_roman`. Output is NFC-normalized so every
    downstream comparator (``OdiaLemmaTable.lookup``, Hindi /
    Marathi lemma lookups in M3, ``form_lemma_overrides``) sees a
    single canonical form regardless of how the input was typed.
    """
    if not text:
        return ""
    src = _resolve_scheme(from_scheme)
    dst = _resolve_script(target_script)
    return unicodedata.normalize("NFC", sanscript.transliterate(text, src, dst))


__all__ = [
    "SUPPORTED_SCHEMES",
    "SUPPORTED_SCRIPTS",
    "UnsupportedSchemeError",
    "UnsupportedScriptError",
    "to_native",
    "to_roman",
]
