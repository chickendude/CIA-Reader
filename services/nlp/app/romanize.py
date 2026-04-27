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
"""

from __future__ import annotations

import unicodedata

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
            f"Romanization scheme {name!r} not implemented; "
            f"supported: {sorted(SUPPORTED_SCHEMES)}"
        ) from e


def to_roman(text: str, *, from_script: str, to_scheme: str) -> str:
    """Transliterate native-script text into a romanization scheme.

    The input is NFC-normalized defensively — the /process HTTP layer
    already does this globally, but the batch correction worker and
    dictionary-import code call this module directly, and a
    mis-normalized surface shouldn't produce a mis-romanized output.
    Empty string in, empty string out — a no-op rather than an error.
    """
    if not text:
        return ""
    normalized = unicodedata.normalize("NFC", text)
    src = _resolve_script(from_script)
    dst = _resolve_scheme(to_scheme)
    return sanscript.transliterate(normalized, src, dst)


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
