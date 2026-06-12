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
#: UI never offers an option that would fail at runtime. ``yivo`` is
#: implemented by the custom Hebrew-script path below, not sanscript —
#: the registry only offers it for Yiddish, so the scheme×script
#: combinations users can reach are always convertible.
SUPPORTED_SCHEMES: frozenset[str] = frozenset(_SCHEME_TO_SANSCRIPT.keys()) | {"yivo"}

#: Read-only view of the scripts this module converts. ``Hebr`` is
#: handled by the custom YIVO path, not sanscript.
SUPPORTED_SCRIPTS: frozenset[str] = frozenset(_SCRIPT_TO_SANSCRIPT.keys()) | {"Hebr"}


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
    # aksharamukha recomposes nukta-bearing consonants back into the
    # precomposed atomic codepoints in U+0958-U+095F (क़ख़ग़ज़ड़ढ़फ़य़) and
    # U+0931 (ऱ). sanscript's Devanagari→ISO table only knows the
    # decomposed form (base + U+093C nukta), so a recomposed ढ़ comes
    # back as the literal Devanagari character with no romanization
    # ("paढ़ēṁ" instead of "paṛhēṁ" for पढ़ें). NFD restores the
    # decomposed form — these codepoints are on Unicode's composition-
    # exclusion list, so NFD will leave them as base + nukta and NFC
    # won't recompose them (they round-trip safely).
    return unicodedata.normalize("NFD", _patch_nukta_final_virama(out))


# Hindi merges the ISO 15919 ē/ō length distinction into a single
# /e/ and /o/. After sanscript emits ISO output we fold the macron
# variants down to plain e/o for the Hindi display layer. Marathi and
# Odia genuinely use the length distinction and skip this fold.
_HINDI_ISO_FOLD = str.maketrans({"ē": "e", "ō": "o", "Ē": "E", "Ō": "O"})


# ====================================================================
# Yiddish: Hebrew script ↔ YIVO romanization
# ====================================================================
#
# sanscript knows nothing about Hebrew script, so the YIVO scheme is a
# hand-built mapping. YIVO romanization of *standard Yiddish
# orthography* (the pointed YIVO spelling: אַ אָ בֿ וּ יִ כּ פּ פֿ שׂ תּ) is
# close to deterministic for the Germanic / Slavic component of the
# vocabulary. The loshn-koydesh (Hebrew/Aramaic-origin) component is
# spelled etymologically and unpointed — שבת is pronounced "shabes",
# not the letter-by-letter "shbs" this table produces. Same tier of
# honesty as the Odia pipeline: rule output is a best effort, and the
# dictionary's per-lemma romanizations (M3) override it where it's
# wrong. Display-only, like the Hindi schwa-deleted output.
#
# Sequences are matched longest-first. Pointed letters are the NFC
# forms (base letter + combining point — Unicode excludes the Hebrew
# presentation forms from recomposition, so NFC input is always
# decomposed).

_YI_PASEKH = "ַ"  # ◌ַ  (patah)
_YI_KOMETS = "ָ"  # ◌ָ  (qamats)
_YI_KHIRIK = "ִ"  # ◌ִ  (hiriq)
_YI_DAGESH = "ּ"  # ◌ּ
_YI_RAFE = "ֿ"  # ◌ֿ
_YI_SHIN_DOT = "ׁ"  # ◌ׁ
_YI_SIN_DOT = "ׂ"  # ◌ׂ

# Sentinel for a bare yud whose reading (consonantal "y" vs vocalic
# "i") depends on what follows. Resolved in a second pass.
_YI_YUD = object()

# (sequence, romanization) — longest sequences first within each
# group; the scanner takes the first entry that matches at the cursor.
_HEBR_TO_YIVO: tuple[tuple[str, object], ...] = (
    # Affricate / sibilant clusters
    ("דזש", "dzh"),
    ("זש", "zh"),
    ("טש", "tsh"),
    # Vov + yud combinations. ויִ (vov, khirik-yud) is "ui" (רויִק →
    # ruik) and must outrank the וי → "oy" digraph.
    ("ויִ", "ui"),
    ("וי", "oy"),
    ("ױ" + _YI_KHIRIK, "ui"),
    ("ױ", "oy"),
    ("וו", "v"),
    ("װ", "v"),
    ("וּ", "u"),
    # Yud combinations. ייִ (yud, khirik-yud) is "yi" (ייִדיש → yidish)
    # and must outrank יי → "ey". The pasekh forms are "ay".
    ("ייַ", "ay"),
    ("ײַ", "ay"),
    ("ייִ", "yi"),
    ("יי", "ey"),
    ("ײ", "ey"),
    ("יִ", "i"),
    # Pointed alef / single letters
    ("אַ", "a"),
    ("אָ", "o"),
    ("א", ""),  # shtumer alef — a silent placeholder
    ("בֿ", "v"),
    ("ב" + _YI_DAGESH, "b"),
    ("ב", "b"),
    ("ג", "g"),
    ("ד", "d"),
    ("ה", "h"),
    ("ו", "u"),
    ("ז", "z"),
    ("ח", "kh"),
    ("ט", "t"),
    ("י", _YI_YUD),
    ("כּ", "k"),
    ("כ", "kh"),
    ("ך", "kh"),
    ("ל", "l"),
    ("מ", "m"),
    ("ם", "m"),
    ("נ", "n"),
    ("ן", "n"),
    ("ס", "s"),
    ("ע", "e"),
    ("פּ", "p"),
    ("פֿ", "f"),
    ("פ", "f"),
    ("ף", "f"),
    ("צ", "ts"),
    ("ץ", "ts"),
    ("ק", "k"),
    ("ר", "r"),
    ("שׂ", "s"),
    ("ש" + _YI_SHIN_DOT, "sh"),
    ("ש", "sh"),
    ("תּ", "t"),
    ("ת", "s"),
    # Yiddish punctuation that has a conventional Latin rendering.
    ("׳", "'"),
    ("״", '"'),
    ("־", "-"),
)

_YIVO_VOWELS = frozenset("aeiou")


def _hebrew_to_yivo(text: str) -> str:
    """Transliterate NFC Hebrew-script text into YIVO romanization.

    Single forward scan with longest-first matching, then a resolution
    pass for bare yud: consonantal ``y`` when the next emitted unit
    starts with a vowel (יאָר → yor), vocalic ``i`` otherwise (קינד →
    kind). Unknown characters (Latin digits, stray punctuation,
    leftover Hebrew points like sheva) pass through except combining
    marks, which are dropped — a mark we didn't pair with its base
    letter has no YIVO rendering of its own.
    """
    units: list[object] = []
    i = 0
    n = len(text)
    while i < n:
        for seq, out in _HEBR_TO_YIVO:
            if text.startswith(seq, i):
                units.append(out)
                i += len(seq)
                break
        else:
            ch = text[i]
            if unicodedata.category(ch).startswith("M"):
                pass  # unpaired combining point — drop
            else:
                units.append(ch)
            i += 1

    pieces: list[str] = []
    for idx, unit in enumerate(units):
        if unit is not _YI_YUD:
            pieces.append(unit)  # type: ignore[arg-type]
            continue
        nxt = next(
            (u for u in units[idx + 1 :] if u is _YI_YUD or u != ""),
            None,
        )
        if nxt is _YI_YUD:
            # Two bare yuds in a row would have matched יי above; a
            # resolved second yud behaves like a vowel-initial unit.
            pieces.append("y")
        elif isinstance(nxt, str) and nxt and nxt[0] in _YIVO_VOWELS:
            pieces.append("y")
        else:
            pieces.append("i")
    return "".join(pieces)


# YIVO → Hebrew script, for the script-aware input path (typing
# "shraybn" produces שרײַבן). Longest-first; the per-word post-passes
# below handle final letters and the word-initial shtumer alef.
_YIVO_TO_HEBR: tuple[tuple[str, str], ...] = (
    ("dzh", "דזש"),
    ("tsh", "טש"),
    ("zh", "זש"),
    ("sh", "ש"),
    ("kh", "כ"),
    ("ts", "צ"),
    ("ay", "ײַ"),
    ("ey", "יי"),
    ("oy", "וי"),
    ("a", "אַ"),
    ("o", "אָ"),
    ("u", "ו"),
    ("i", "י"),
    ("e", "ע"),
    ("b", "ב"),
    ("d", "ד"),
    ("f", "פֿ"),
    ("g", "ג"),
    ("h", "ה"),
    ("k", "ק"),
    ("l", "ל"),
    ("m", "מ"),
    ("n", "נ"),
    ("p", "פּ"),
    ("r", "ר"),
    ("s", "ס"),
    ("t", "ט"),
    ("v", "וו"),
    ("y", "י"),
    ("z", "ז"),
)

# Non-final → final letter at word end. פֿ loses its rafe as ף.
_YI_FINAL_FORMS: dict[str, str] = {
    "מ": "ם",
    "נ": "ן",
    "פֿ": "ף",
    "צ": "ץ",
    "כ": "ך",
}

_LATIN_WORD_RE = re.compile(r"[A-Za-z]+")


# Latin sequences that begin a word with a *vocalic* vov / yud and
# therefore need a leading shtumer alef (un → און, in → אין, oyb →
# אויב). Consonantal y (yor → יאָר) and v do not.
_YI_VOCALIC_STARTS = frozenset({"u", "i", "oy", "ey", "ay"})


def _yivo_word_to_hebrew(word: str) -> str:
    # (latin_seq, hebrew) pairs so the orthographic post-passes can
    # distinguish vocalic i/u from consonantal y/v, which map to the
    # same base letters.
    units: list[tuple[str, str]] = []
    i = 0
    n = len(word)
    lower = word.lower()
    while i < n:
        for seq, heb in _YIVO_TO_HEBR:
            if lower.startswith(seq, i):
                units.append((seq, heb))
                i += len(seq)
                break
        else:
            units.append((word[i], word[i]))
            i += 1
    if not units:
        return word
    # Vocalic i / u adjacent to look-alike letters take their
    # distinguishing point so the cluster doesn't read as a digraph:
    # khirik yud next to any yud or vov (yidish → ייִדיש, ruik → רויִק),
    # melupm vov only next to a consonantal vov (vu → וווּ). Adjacency
    # is judged against the unpointed units, so one fix can't suppress
    # its neighbor's.
    pointed = list(units)
    for idx, (seq, heb) in enumerate(units):
        prev_seq, prev_heb = units[idx - 1] if idx > 0 else ("", "")
        next_seq, next_heb = units[idx + 1] if idx + 1 < len(units) else ("", "")
        if seq == "i" and (
            prev_heb[-1:] in ("י", "ו") or next_heb[:1] in ("י", "ו")
        ):
            pointed[idx] = (seq, heb + _YI_KHIRIK)
        elif seq == "u" and ("v" in (prev_seq, next_seq)):
            pointed[idx] = (seq, heb + _YI_DAGESH)
    units = pointed
    out = [heb for _, heb in units]
    # Word-initial vocalic ו / י take a shtumer alef.
    if units[0][0] in _YI_VOCALIC_STARTS:
        out.insert(0, "א")
    # Word-final letters swap to their final forms: nemen → נעמען with
    # a terminal ן, not נעמענ.
    if out[-1] in _YI_FINAL_FORMS:
        out[-1] = _YI_FINAL_FORMS[out[-1]]
    return "".join(out)


def _yivo_to_hebrew(text: str) -> str:
    """Transliterate YIVO-romanized text into Hebrew-script Yiddish.

    The inverse of :func:`_hebrew_to_yivo` for the unambiguous core.
    Lossy at the edges by nature — YIVO "k" can't know whether the
    original was ק or כּ, "v" picks וו over the loshn-koydesh בֿ —
    which matches its use: live input conversion, where the user
    confirms the produced spelling on screen.
    """
    return _LATIN_WORD_RE.sub(lambda m: _yivo_word_to_hebrew(m.group(0)), text)


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
    if from_script == "Hebr":
        # Hebrew script bypasses sanscript entirely. YIVO is the only
        # scheme defined for it — the registry never offers another.
        if to_scheme != "yivo":
            raise UnsupportedSchemeError(
                f"Script 'Hebr' only romanizes to 'yivo', not {to_scheme!r}"
            )
        return _hebrew_to_yivo(normalized)
    if to_scheme == "yivo":
        raise UnsupportedSchemeError(
            f"Romanization scheme 'yivo' is only defined for script 'Hebr', "
            f"not {from_script!r}"
        )
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
    if target_script == "Hebr":
        if from_scheme != "yivo":
            raise UnsupportedSchemeError(
                f"Script 'Hebr' only converts from 'yivo', not {from_scheme!r}"
            )
        return unicodedata.normalize("NFC", _yivo_to_hebrew(text))
    if from_scheme == "yivo":
        raise UnsupportedSchemeError(
            f"Romanization scheme 'yivo' is only defined for script 'Hebr', "
            f"not {target_script!r}"
        )
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
