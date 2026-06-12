"""Unit tests for :mod:`app.romanize` (T-2.5).

Covers both directions (native → roman, roman → native), both MVP
scripts (Devanagari for Hindi/Marathi, Odia for Odia), the round-trip
invariant for each supported scheme, empty-input behavior, and the
unsupported-script / unsupported-scheme error cases (Hunterian in
particular — it's in the registry but not in this module).
"""

from __future__ import annotations

import unicodedata

import pytest

from app import romanize

# ---- to_roman (native → romanization scheme) ----


def test_hindi_devanagari_to_iast():
    # "नमस्ते" → "namaste" in IAST.
    assert romanize.to_roman("नमस्ते", from_script="Deva", to_scheme="iast") == "namaste"


def test_hindi_devanagari_to_iso():
    # ISO 15919 and IAST diverge on several letters; for "नमस्ते" they
    # happen to agree, so test on a surface that distinguishes them.
    # "ऋ" (vocalic r) → "r̥" in ISO, "ṛ" in IAST.
    iso = romanize.to_roman("ऋषि", from_script="Deva", to_scheme="iso15919")
    iast = romanize.to_roman("ऋषि", from_script="Deva", to_scheme="iast")
    assert "r̥" in iso
    assert "ṛ" in iast


def test_odia_to_iast():
    # "ନମସ୍କାର" → ISO/IAST: "namaskāra"
    out = romanize.to_roman("ନମସ୍କାର", from_script="Orya", to_scheme="iast")
    assert out == "namaskāra"


def test_odia_to_iso15919():
    out = romanize.to_roman("ଦୁନିଆ", from_script="Orya", to_scheme="iso15919")
    # Must be purely ASCII + diacritics, no Odia codepoints left.
    assert all(ord(c) < 0x0900 for c in out)
    assert out.startswith("dun")


def test_to_roman_nfc_normalizes_input():
    # Devanagari ka+nukta: precomposed (U+0958) vs decomposed (ka + combining nukta).
    # NFC decomposes U+0958 (it's in the composition exclusion list), so after
    # NFC normalization both inputs are identical and must transliterate the same.
    precomposed = "\u0958"
    nfd_like = "\u0915\u093c"
    a = romanize.to_roman(precomposed, from_script="Deva", to_scheme="iast")
    b = romanize.to_roman(nfd_like, from_script="Deva", to_scheme="iast")
    assert a == b
    assert a != ""


def test_to_roman_empty_is_empty():
    assert romanize.to_roman("", from_script="Deva", to_scheme="iast") == ""


# ---- Hindi-specific: schwa deletion + ē/ō → e/o fold ----
#
# These exercise the ``language="hi"`` opt-in path documented in the
# module. Without the kwarg sanscript alone produces "rāma" / "kamala"
# / "bhārata" — correct for Sanskrit, wrong for Hindi.


@pytest.mark.parametrize(
    "native,expected_iso",
    [
        ("राम", "rām"),  # final schwa deleted
        ("कमल", "kamal"),  # final schwa deleted
        ("भारत", "bhārat"),  # medial schwa kept, final deleted
        ("कमला", "kamlā"),  # medial schwa deleted, long ā preserved
        ("धर्म", "dharm"),  # consonant cluster, final deleted
        ("पुस्तक", "pustak"),  # final deleted, NFC-stable
    ],
)
def test_hindi_schwa_deletion_iso(native: str, expected_iso: str):
    out = romanize.to_roman(native, from_script="Deva", to_scheme="iso15919", language="hi")
    assert out == expected_iso


def test_hindi_schwa_deletion_applies_to_iast_too():
    # Schwa deletion is a phonological fact about Hindi, so it must
    # apply regardless of which roman scheme is requested. IAST
    # output should also drop the trailing schwa.
    iast = romanize.to_roman("राम", from_script="Deva", to_scheme="iast", language="hi")
    assert iast == "rām"


def test_hindi_iso_folds_long_e_to_short_e():
    # बोलना → "bolna"; without the fold sanscript emits "bōl…" because
    # ISO 15919 mechanically marks े as the long ē. Hindi has only
    # one /e/, so the fold is the right output.
    out = romanize.to_roman("बोलता", from_script="Deva", to_scheme="iso15919", language="hi")
    assert "ē" not in out
    assert "ō" not in out
    assert out == "boltā"


def test_hindi_fold_does_not_apply_to_iast():
    # IAST already uses bare e/o (no length distinction in the scheme),
    # so the fold is a no-op there but worth pinning to catch
    # regressions if the scheme tables shift.
    out = romanize.to_roman("बोलता", from_script="Deva", to_scheme="iast", language="hi")
    assert out == "boltā"


def test_marathi_keeps_inherent_schwa_with_language_hint():
    # Marathi retains the final schwa (राम → "rāma"). Passing
    # ``language="mr"`` must NOT trigger schwa deletion — that's a
    # Hindi-only rule.
    out = romanize.to_roman("राम", from_script="Deva", to_scheme="iso15919", language="mr")
    assert out == "rāma"


def test_marathi_keeps_long_e_macron():
    # Marathi genuinely uses the e/ē length distinction, so the ē→e
    # fold must NOT apply for ``language="mr"``.
    out = romanize.to_roman("हे", from_script="Deva", to_scheme="iso15919", language="mr")
    assert "ē" in out


def test_default_language_keeps_legacy_sanscript_behavior():
    # Without ``language=``, callers (the to_native round-trip path,
    # dictionary tooling) must keep getting raw sanscript output so
    # round-trip remains lossless.
    out = romanize.to_roman("राम", from_script="Deva", to_scheme="iso15919")
    assert out == "rāma"


# ---- Hindi-specific: nukta-final schwa-deletion gap ----
#
# aksharamukha's ``RemoveSchwaHindi`` pre-rule occasionally fails to
# virama-mark the final inherent schwa when a word ends in a
# nukta-bearing consonant (most reliably when preceded by a
# half-consonant). The romanize module patches the gap by appending a
# virama post-hoc; these tests pin both the fix (बर्फ़ → barf, not
# barfa) and the boundary cases that must NOT change.


@pytest.mark.parametrize(
    "native,expected_iso",
    [
        ("बर्फ़", "barf"),  # the canonical bug — half-consonant + final फ़
        ("काग़ज़", "kāġaz"),  # already correct via aksharamukha; regression guard
        ("दर्ज़ी", "darzī"),  # medial nukta + final ी; must stay untouched
        ("बर्फ़ानी", "barfānī"),  # word-internal nukta-final + vowel sign
    ],
)
def test_hindi_nukta_final_schwa_deletion_iso(native: str, expected_iso: str):
    out = romanize.to_roman(native, from_script="Deva", to_scheme="iso15919", language="hi")
    assert out == expected_iso


def test_hindi_nukta_final_schwa_deletion_iast():
    # Same fix must apply regardless of the requested roman scheme,
    # since schwa-deletion is a fact about the Devanagari side.
    assert (
        romanize.to_roman("बर्फ़", from_script="Deva", to_scheme="iast", language="hi") == "barf"
    )


def test_hindi_single_syllable_nukta_keeps_schwa():
    # Standalone single-syllable nukta-final words retain their inherent
    # schwa — matching aksharamukha's behavior for non-nukta finals
    # like क → "ka". Patching this would over-correct.
    assert romanize.to_roman("फ़", from_script="Deva", to_scheme="iso15919", language="hi") == "fa"


def test_hindi_nukta_final_in_phrase_with_punctuation():
    # The patch must operate at word boundaries, not just end-of-string,
    # so trailing punctuation / whitespace / danda still trigger it.
    out = romanize.to_roman(
        "बर्फ़ है।", from_script="Deva", to_scheme="iso15919", language="hi"
    )
    assert out.startswith("barf ")
    assert "barfa" not in out


# ---- Hindi-specific: aksharamukha recomposes nukta atomic codepoints ----
#
# aksharamukha's RemoveSchwaHindi pass leaves the input as decomposed
# (base + U+093C nukta) on the way IN but recomposes the result back to
# the precomposed atomic codepoints (U+0958–U+095F + U+0931) on the way
# OUT. sanscript's Devanagari→ISO table doesn't include those atomic
# letters, so without a fix the romanizer leaves them untouched in the
# middle of an otherwise romanized word ("paढ़ēṁ" instead of "paṛhēṁ"
# for पढ़ें). The romanize module re-applies NFD after aksharamukha to
# restore the decomposed form sanscript understands. These tests pin
# the fix and the surrounding nukta-letter coverage.


@pytest.mark.parametrize(
    "native,expected_iso",
    [
        ("पढ़ें", "paṛheṁ"),  # the canonical bug — medial ढ़, vowel sign + anusvara
        ("पढ़ाई", "paṛhāī"),  # ढ़ + long ā + ī, multi-syllable
        ("बड़ा", "baṛā"),  # ड़ (U+095C) — different nukta letter, same recompose
        ("ज़माना", "zamānā"),  # ज़ (U+095B) at word start
        ("ख़ुश", "k͟huś"),  # ख़ (U+0959), sanscript ISO uses k + combining double macron-below
        ("दर्ज़ी", "darzī"),  # medial ज़; regression guard for the existing fix
    ],
)
def test_hindi_nukta_atomic_codepoints_decompose_for_sanscript(
    native: str, expected_iso: str
):
    out = romanize.to_roman(native, from_script="Deva", to_scheme="iso15919", language="hi")
    assert out == expected_iso, (
        f"{native} romanized to {out!r}; expected {expected_iso!r}. "
        f"Likely cause: aksharamukha's recomposition of nukta letters "
        f"(U+0958-U+095F + U+0931) reached sanscript's Devanagari table "
        f"which doesn't know those codepoints."
    )


def test_hindi_language_hint_is_noop_for_orya():
    # The schwa-deletion path is gated on ``from_script="Deva"`` —
    # Odia text with a stray ``language="hi"`` (a caller bug) must
    # not get mangled by Devanagari-specific preprocessing.
    out = romanize.to_roman("ନମସ୍କାର", from_script="Orya", to_scheme="iast", language="hi")
    assert out == "namaskāra"


# ---- to_native (romanization scheme → native script) ----


def test_iast_to_devanagari():
    assert romanize.to_native("namaste", target_script="Deva", from_scheme="iast") == "नमस्ते"


def test_itrans_to_devanagari():
    assert romanize.to_native("namaste", target_script="Deva", from_scheme="itrans") == "नमस्ते"


def test_iast_to_odia_round_trip_through_iso():
    # Round-trip: Odia → ISO → Odia should recover the original
    # NFC-normalized form.
    original = unicodedata.normalize("NFC", "ଦୁନିଆ")
    roman = romanize.to_roman(original, from_script="Orya", to_scheme="iso15919")
    back = romanize.to_native(roman, target_script="Orya", from_scheme="iso15919")
    assert back == original


def test_to_native_output_is_nfc_normalized():
    # "r̥" (ISO notation for vocalic r) decomposed vs precomposed. The
    # output must always be NFC so downstream lemma lookups compare
    # apples to apples.
    out = romanize.to_native("r̥ṣi", target_script="Deva", from_scheme="iso15919")
    assert out == unicodedata.normalize("NFC", out)


def test_to_native_empty_is_empty():
    assert romanize.to_native("", target_script="Deva", from_scheme="iast") == ""


# ---- script / scheme validation ----


def test_unsupported_script_raises_descriptive_error():
    with pytest.raises(romanize.UnsupportedScriptError) as exc:
        romanize.to_roman("foo", from_script="Arab", to_scheme="iast")
    # Error message must name the supported set so the caller can
    # correct without reading the module.
    assert "Arab" in str(exc.value)
    assert "Deva" in str(exc.value) or "Orya" in str(exc.value)


def test_unsupported_scheme_raises_for_hunterian():
    # Hunterian is in the registry's supported_romanizations but not
    # implemented by this module — web layer falls back to iso15919
    # for display. This test pins the contract so a silent switch to
    # "Hunterian returns garbage" is impossible.
    with pytest.raises(romanize.UnsupportedSchemeError) as exc:
        romanize.to_roman("नमस्ते", from_script="Deva", to_scheme="hunterian")
    assert "hunterian" in str(exc.value)


def test_unsupported_scheme_raises_for_unknown_name():
    with pytest.raises(romanize.UnsupportedSchemeError):
        romanize.to_native("x", target_script="Deva", from_scheme="not-a-real-scheme")


# ---- round-trip invariants ----


@pytest.mark.parametrize(
    "native,script",
    [
        ("नमस्ते", "Deva"),
        ("दुनिया", "Deva"),
        ("बोलता", "Deva"),
        ("ନମସ୍କାର", "Orya"),
        ("ଦୁନିଆ", "Orya"),
        ("ଘରରେ", "Orya"),
    ],
)
@pytest.mark.parametrize("scheme", ["iast", "iso15919", "itrans", "velthuis"])
def test_round_trip_preserves_native(native: str, script: str, scheme: str):
    roman = romanize.to_roman(native, from_script=script, to_scheme=scheme)
    back = romanize.to_native(roman, target_script=script, from_scheme=scheme)
    assert back == unicodedata.normalize("NFC", native), (
        f"round-trip broken for {native!r} via {scheme}: {native!r} -> {roman!r} -> {back!r}"
    )


def test_supported_schemes_exposed_as_frozenset():
    # Validation at the API layer will check membership in this set;
    # guard its shape here.
    assert "iast" in romanize.SUPPORTED_SCHEMES
    assert "iso15919" in romanize.SUPPORTED_SCHEMES
    assert "hunterian" not in romanize.SUPPORTED_SCHEMES
    assert isinstance(romanize.SUPPORTED_SCHEMES, frozenset)


def test_supported_scripts_exposed_as_frozenset():
    assert "Deva" in romanize.SUPPORTED_SCRIPTS
    assert "Orya" in romanize.SUPPORTED_SCRIPTS
    assert "Arab" not in romanize.SUPPORTED_SCRIPTS
    assert isinstance(romanize.SUPPORTED_SCRIPTS, frozenset)


# ---- Yiddish: Hebrew script ↔ YIVO (custom path, no sanscript) ----


@pytest.mark.parametrize(
    ("native", "expected"),
    [
        ("ייִדיש", "yidish"),
        ("שרײַבן", "shraybn"),
        ("בוך", "bukh"),
        ("איך", "ikh"),
        # Consonantal yud before a vowel vs vocalic yud before a consonant.
        ("יאָר", "yor"),
        ("קינד", "kind"),
        # Ligature and two-letter spellings romanize identically.
        ("װאַסער", "vaser"),
        ("וואַסער", "vaser"),
        ("הויז", "hoyz"),
        ("פֿרײַנד", "fraynd"),
        ("געשריבן", "geshribn"),
        # ויִ (vov + khirik-yud) is "ui", not the וי "oy" digraph.
        ("רויִק", "ruik"),
        ("צוויי", "tsvey"),
        ("מענטש", "mentsh"),
        ("זשורנאַל", "zhurnal"),
    ],
)
def test_yivo_romanization(native: str, expected: str):
    assert (
        romanize.to_roman(native, from_script="Hebr", to_scheme="yivo", language="yi")
        == expected
    )


def test_yivo_loshn_koydesh_is_best_effort():
    # Hebrew-origin words are spelled etymologically and unpointed —
    # the letter-by-letter output is documented as a best effort
    # (real pronunciation: "shabes"). Dictionary-level romanizations
    # override this downstream.
    out = romanize.to_roman("שבת", from_script="Hebr", to_scheme="yivo")
    assert out == "shbs"


@pytest.mark.parametrize(
    "latin",
    ["shraybn", "yor", "yidish", "un", "in", "oyb", "nemen", "vu", "ruik", "kind"],
)
def test_yivo_to_native_round_trips(latin: str):
    native = romanize.to_native(latin, target_script="Hebr", from_scheme="yivo")
    back = romanize.to_roman(native, from_script="Hebr", to_scheme="yivo")
    assert back == latin, f"{latin!r} -> {native!r} -> {back!r}"


def test_yivo_to_native_orthography_details():
    # Word-initial vocalic vov/yud take a shtumer alef…
    assert romanize.to_native("un", target_script="Hebr", from_scheme="yivo") == "און"
    # …consonantal y does not.
    assert romanize.to_native("yor", target_script="Hebr", from_scheme="yivo") == "יאָר"
    # Word-final letters use their final forms.
    assert romanize.to_native("nemen", target_script="Hebr", from_scheme="yivo") == "נעמען"


def test_yivo_scheme_rejected_for_non_hebrew_scripts():
    with pytest.raises(romanize.UnsupportedSchemeError):
        romanize.to_roman("नमस्ते", from_script="Deva", to_scheme="yivo")
    with pytest.raises(romanize.UnsupportedSchemeError):
        romanize.to_native("namaste", target_script="Deva", from_scheme="yivo")


def test_hebrew_script_rejects_indic_schemes():
    with pytest.raises(romanize.UnsupportedSchemeError):
        romanize.to_roman("בוך", from_script="Hebr", to_scheme="iso15919")
    with pytest.raises(romanize.UnsupportedSchemeError):
        romanize.to_native("bukh", target_script="Hebr", from_scheme="iso15919")


def test_yivo_and_hebr_in_supported_sets():
    assert "yivo" in romanize.SUPPORTED_SCHEMES
    assert "Hebr" in romanize.SUPPORTED_SCRIPTS
