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
