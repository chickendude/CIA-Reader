"""Unit tests for :mod:`app.numbers` (T-2.8).

The 0–99 spelled-out forms in three languages plus the base-100 / 1k /
lakh / crore composition rules are easy to typo and hard to spot
without a native reader, so we pin a sweep of reference values and let
CI catch regressions.

Reference values were cross-checked against published number tables
(NCERT Hindi mathematics primers; Marathi BalBharti texts; Odia
Govt.-of-Odisha textbooks) and curator review on the trickier 50–99
sandhi forms is part of T-2.8 sign-off.
"""

from __future__ import annotations

import pytest

from app.numbers import (
    MAX_VALUE,
    digits_in_script,
    format_in_script,
    number_forms,
    parse_digits,
    parse_number,
    spell,
    to_words_hi,
    to_words_mr,
    to_words_or,
)
from app.schemas import NumberForms

# ----------------------------------------------------------------
# parse_digits
# ----------------------------------------------------------------


@pytest.mark.parametrize(
    "surface,expected",
    [
        ("0", 0),
        ("9", 9),
        ("10", 10),
        ("123", 123),
        ("9999999", 9_999_999),
        ("10000000", 10_000_000),
        # Devanagari digits
        ("०", 0),
        ("१२३", 123),
        ("१०००", 1_000),
        # Odia digits
        ("୦", 0),
        ("୧୨୩", 123),
        ("୯୯୯", 999),
    ],
)
def test_parse_digits_accepts_single_script(surface: str, expected: int) -> None:
    assert parse_digits(surface) == expected


@pytest.mark.parametrize(
    "surface,expected",
    [
        # Western thousands grouping
        ("1,000", 1_000),
        ("12,345", 12_345),
        ("123,456", 123_456),
        ("1,234,567", 1_234_567),
        ("9,999,999", 9_999_999),
        # Indian lakh grouping
        ("10,000", 10_000),
        ("1,00,000", 100_000),
        ("12,34,567", 1_234_567),
        ("99,99,999", 9_999_999),
        # Native-script digits with separators
        ("१,२३४", 1_234),
        ("१,००,०००", 100_000),
        ("୧,୨୩୪", 1_234),
    ],
)
def test_parse_digits_accepts_comma_separators(surface: str, expected: int) -> None:
    assert parse_digits(surface) == expected


@pytest.mark.parametrize(
    "surface",
    [
        "",
        "abc",
        " ",
        "12a",
        # Mixed-script: not allowed.
        "१23",
        "1२3",
        "1୨3",
        "१୨३",
        # Sign / decimal: T-2.8a.
        "-1",
        "+1",
        "−1",
        "1.5",
        ".5",
        "1.",
        # Malformed comma positions
        ",1",
        "1,",
        "1,,000",
        ",",
        ",,",
        # Out of range.
        "10000001",
        "99999999",
        "10,000,001",
    ],
)
def test_parse_digits_rejects(surface: str) -> None:
    assert parse_digits(surface) is None


# ----------------------------------------------------------------
# digits_in_script
# ----------------------------------------------------------------


@pytest.mark.parametrize(
    "n,latin,deva,orya",
    [
        (0, "0", "०", "୦"),
        (9, "9", "९", "୯"),
        (10, "10", "१०", "୧୦"),
        (123, "123", "१२३", "୧୨୩"),
        (9_999_999, "9999999", "९९९९९९९", "୯୯୯୯୯୯୯"),
        (10_000_000, "10000000", "१" + "०" * 7, "୧" + "୦" * 7),
    ],
)
def test_digits_in_script(n: int, latin: str, deva: str, orya: str) -> None:
    assert digits_in_script(n, "latin") == latin
    assert digits_in_script(n, "deva") == deva
    assert digits_in_script(n, "orya") == orya


@pytest.mark.parametrize("n", [-1, MAX_VALUE + 1, 100_000_000])
def test_digits_in_script_out_of_range(n: int) -> None:
    with pytest.raises(ValueError):
        digits_in_script(n, "latin")


# ----------------------------------------------------------------
# Hindi spelled-out — pinned reference values.
# ----------------------------------------------------------------

_HINDI_REFERENCE: list[tuple[int, str]] = [
    (0, "शून्य"),
    (1, "एक"),
    (2, "दो"),
    (3, "तीन"),
    (5, "पाँच"),
    (10, "दस"),
    (11, "ग्यारह"),
    (15, "पंद्रह"),
    (19, "उन्नीस"),
    (20, "बीस"),
    (21, "इक्कीस"),
    (30, "तीस"),
    (50, "पचास"),
    (99, "निन्यानवे"),
    (100, "एक सौ"),
    (101, "एक सौ एक"),
    (123, "एक सौ तेईस"),
    (500, "पाँच सौ"),
    (999, "नौ सौ निन्यानवे"),
    (1_000, "एक हज़ार"),
    (1_234, "एक हज़ार दो सौ चौंतीस"),
    (9_999, "नौ हज़ार नौ सौ निन्यानवे"),
    (10_000, "दस हज़ार"),
    (100_000, "एक लाख"),
    (123_456, "एक लाख तेईस हज़ार चार सौ छप्पन"),
    (1_000_000, "दस लाख"),
    (9_999_999, "निन्यानवे लाख निन्यानवे हज़ार नौ सौ निन्यानवे"),
    (10_000_000, "एक करोड़"),
]


@pytest.mark.parametrize("n,expected", _HINDI_REFERENCE)
def test_to_words_hi_pinned(n: int, expected: str) -> None:
    assert to_words_hi(n) == expected


# ----------------------------------------------------------------
# Marathi spelled-out — pinned reference values.
# ----------------------------------------------------------------

_MARATHI_REFERENCE: list[tuple[int, str]] = [
    (0, "शून्य"),
    (1, "एक"),
    (2, "दोन"),
    (5, "पाच"),
    (9, "नऊ"),
    (10, "दहा"),
    (16, "सोळा"),
    (19, "एकोणीस"),
    (20, "वीस"),
    (23, "तेवीस"),
    (50, "पन्नास"),
    (99, "नव्व्याण्णव"),
    (100, "एकशे"),
    (101, "एकशे एक"),
    (123, "एकशे तेवीस"),
    (200, "दोनशे"),
    (500, "पाचशे"),
    (1_000, "एक हजार"),
    (1_234, "एक हजार दोनशे चौतीस"),
    (10_000, "दहा हजार"),
    (100_000, "एक लाख"),
    (1_000_000, "दहा लाख"),
    (10_000_000, "एक कोटी"),
]


@pytest.mark.parametrize("n,expected", _MARATHI_REFERENCE)
def test_to_words_mr_pinned(n: int, expected: str) -> None:
    assert to_words_mr(n) == expected


# ----------------------------------------------------------------
# Odia spelled-out — pinned reference values.
# ----------------------------------------------------------------

_ODIA_REFERENCE: list[tuple[int, str]] = [
    (0, "ଶୂନ୍ୟ"),
    (1, "ଏକ"),
    (2, "ଦୁଇ"),
    (5, "ପାଞ୍ଚ"),
    (9, "ନଅ"),
    (10, "ଦଶ"),
    (20, "କୋଡ଼ିଏ"),
    (23, "ତେଇଶ"),
    (50, "ପଚାଶ"),
    (100, "ଏକ ଶହ"),
    (123, "ଏକ ଶହ ତେଇଶ"),
    (500, "ପାଞ୍ଚ ଶହ"),
    (1_000, "ଏକ ହଜାର"),
    (10_000, "ଦଶ ହଜାର"),
    (100_000, "ଏକ ଲକ୍ଷ"),
    (1_000_000, "ଦଶ ଲକ୍ଷ"),
    (10_000_000, "ଏକ କୋଟି"),
]


@pytest.mark.parametrize("n,expected", _ODIA_REFERENCE)
def test_to_words_or_pinned(n: int, expected: str) -> None:
    assert to_words_or(n) == expected


# ----------------------------------------------------------------
# Range guards.
# ----------------------------------------------------------------


@pytest.mark.parametrize("converter", [to_words_hi, to_words_mr, to_words_or])
@pytest.mark.parametrize("n", [-1, MAX_VALUE + 1, 100_000_000])
def test_to_words_out_of_range(converter, n: int) -> None:
    with pytest.raises(ValueError):
        converter(n)


# ----------------------------------------------------------------
# Sweep: every value 0..99 must produce a non-empty string in every
# language. Caught a real bug during development where the Marathi
# table had a duplicate entry and silently shifted the rest of the
# row, so we keep the sweep as a regression guard rather than spelling
# out 100 expectations per language.
# ----------------------------------------------------------------


@pytest.mark.parametrize("converter", [to_words_hi, to_words_mr, to_words_or])
def test_below_100_sweep_non_empty(converter) -> None:
    seen: set[str] = set()
    for i in range(100):
        out = converter(i)
        assert out, f"{converter.__name__}({i}) empty"
        # No duplicates — every 0..99 form should be unique within a
        # language. (Hindi १६ vs ६१ = सोलह vs इकसठ are distinct words.)
        assert out not in seen, f"{converter.__name__}({i})={out!r} dup"
        seen.add(out)


# ----------------------------------------------------------------
# number_forms — the public entry point.
# ----------------------------------------------------------------


def test_number_forms_for_123() -> None:
    nf = number_forms("123")
    assert isinstance(nf, NumberForms)
    # T-2.8a: ``value`` is the canonical Latin-digit string form so
    # signed + decimal numerals can round-trip without floating-point
    # drift. Unsigned integers serialize as plain digits, no sign.
    assert nf.value == "123"
    assert nf.digits_latin == "123"
    assert nf.digits_deva == "१२३"
    assert nf.digits_orya == "୧୨୩"
    assert nf.hi.spelled == "एक सौ तेईस"
    assert nf.hi.romanized == "ek sau teīs"
    assert nf.mr.spelled == "एकशे तेवीस"
    # Marathi keeps macrons (no Hindi-style ē/ō → e/o fold).
    assert "ē" in nf.mr.romanized
    assert nf.odia.spelled == "ଏକ ଶହ ତେଇଶ"
    assert "ē" in nf.odia.romanized


def test_number_forms_devanagari_input() -> None:
    nf = number_forms("१२३")
    assert nf is not None
    assert nf.value == "123"
    assert nf.digits_latin == "123"


def test_number_forms_odia_input() -> None:
    nf = number_forms("୧୨୩")
    assert nf is not None
    assert nf.value == "123"
    assert nf.digits_deva == "१२३"


def test_number_forms_zero() -> None:
    nf = number_forms("0")
    assert nf is not None
    assert nf.value == "0"
    assert nf.hi.spelled == "शून्य"
    assert nf.mr.spelled == "शून्य"
    assert nf.odia.spelled == "ଶୂନ୍ୟ"


def test_number_forms_max() -> None:
    nf = number_forms("10000000")
    assert nf is not None
    assert nf.value == "10000000"


def test_number_forms_serializes_odia_field() -> None:
    """The wire field for Odia is ``odia`` (not the ISO 639-1 code
    ``or``, which is a reserved Python keyword). The TypeScript
    mirror in apps/web/src/lib/server/nlp-client.ts depends on this."""
    nf = number_forms("1")
    assert nf is not None
    payload = nf.model_dump()
    assert "odia" in payload
    assert "or" not in payload


@pytest.mark.parametrize(
    "surface",
    [
        "",
        "abc",
        "१23",  # mixed
        # Note: `-1` and `1.5` USED to live here when number_forms only
        # supported the unsigned-integer path. T-2.8a routes them
        # through parse_number, so they're accepted now — see the new
        # decimal/negative tests below.
        "1.",  # trailing decimal — still rejected
        ".5",  # leading decimal — still rejected
        "1.2.3",  # multiple decimals
        "-",  # lonely sign
        "−",  # lonely U+2212
        "10000001",  # out of range
        "100000000",
    ],
)
def test_number_forms_returns_none_for_non_qualifying(surface: str) -> None:
    assert number_forms(surface) is None


# ----------------------------------------------------------------
# T-2.8a: parse_number — signed / decimal extensions.
# ----------------------------------------------------------------


@pytest.mark.parametrize(
    "surface,expected",
    [
        # Unsigned positive — equivalent to parse_digits (minus the
        # comma path).
        ("0", ("+", 0, None)),
        ("123", ("+", 123, None)),
        ("9999999", ("+", 9_999_999, None)),
        ("10000000", ("+", 10_000_000, None)),
        # Negatives — ASCII hyphen-minus.
        ("-1", ("-", 1, None)),
        ("-100", ("-", 100, None)),
        ("-9999999", ("-", 9_999_999, None)),
        # Negatives — U+2212 MINUS SIGN.
        ("−5", ("-", 5, None)),
        ("−99", ("-", 99, None)),
        # Decimals — Latin digits.
        ("0.5", ("+", 0, "5")),
        ("3.14", ("+", 3, "14")),
        # Leading-zero fractional preserved (so the wire ``value``
        # round-trips ``0.001`` rather than collapsing to ``0.1``).
        ("0.001", ("+", 0, "001")),
        ("123.456", ("+", 123, "456")),
        # Negative + decimal.
        ("-2.5", ("-", 2, "5")),
        ("−2.5", ("-", 2, "5")),
        # Native-script digits.
        ("१२३", ("+", 123, None)),
        ("-१२३", ("-", 123, None)),
        ("३.१४", ("+", 3, "14")),  # Devanagari, fractional normalized to Latin
        ("୧୨୩", ("+", 123, None)),
        ("-୨", ("-", 2, None)),
        ("୦.୦୦୧", ("+", 0, "001")),
    ],
)
def test_parse_number_accepts(
    surface: str, expected: tuple[str, int, str | None]
) -> None:
    assert parse_number(surface) == expected


@pytest.mark.parametrize(
    "surface",
    [
        "",
        "-",
        "−",  # lonely U+2212
        "--1",
        "-−1",
        "1-2",
        "1.",
        ".5",
        "1.2.3",
        "1,000",  # comma-grouping is the parse_digits path, not this one
        "-1,000",
        # Mixed-script across the decimal — Devanagari ``1.२`` mixed
        # with Latin or different-script fractional.
        "१.5",
        "1.२",
        "१.୨",
        # Sign on a non-numeric.
        "-abc",
        "-",
        # Out of range integer part.
        "-10000001",
        "10000001",
    ],
)
def test_parse_number_rejects(surface: str) -> None:
    assert parse_number(surface) is None


def test_parse_number_accepts_max_integer_with_fractional() -> None:
    """Boundary: 10⁷ is the inclusive upper bound on the integer part.
    A decimal at that bound is fine — only the integer part is
    capped, the fractional part is unbounded."""
    assert parse_number("10000000.5") == ("+", 10_000_000, "5")
    assert parse_number("-10000000.5") == ("-", 10_000_000, "5")


# ----------------------------------------------------------------
# T-2.8a: format_in_script — sign + decimal renderer.
# ----------------------------------------------------------------


@pytest.mark.parametrize(
    "sign,integer,fractional,latin,deva,orya",
    [
        ("+", 0, None, "0", "०", "୦"),
        ("+", 123, None, "123", "१२३", "୧୨୩"),
        ("-", 12, None, "-12", "-१२", "-୧୨"),
        ("+", 3, "14", "3.14", "३.१४", "୩.୧୪"),
        ("-", 2, "5", "-2.5", "-२.५", "-୨.୫"),
        # Leading-zero fractional preserved per script.
        ("+", 0, "001", "0.001", "०.००१", "୦.୦୦୧"),
    ],
)
def test_format_in_script(
    sign: str,
    integer: int,
    fractional: str | None,
    latin: str,
    deva: str,
    orya: str,
) -> None:
    assert format_in_script(sign, integer, fractional, "latin") == latin  # type: ignore[arg-type]
    assert format_in_script(sign, integer, fractional, "deva") == deva  # type: ignore[arg-type]
    assert format_in_script(sign, integer, fractional, "orya") == orya  # type: ignore[arg-type]


# ----------------------------------------------------------------
# T-2.8a: spell — composed sign + decimal output. Pinned reference
# values in each language so a typo in ऋण / उणे / ଋଣ or दशमलव /
# दशांश / ଦଶମିକ trips CI rather than ships silently.
# ----------------------------------------------------------------


@pytest.mark.parametrize(
    "sign,integer,fractional,hi,mr,or_",
    [
        ("-", 1, None, "ऋण एक", "उणे एक", "ଋଣ ଏକ"),
        ("-", 100, None, "ऋण एक सौ", "उणे एकशे", "ଋଣ ଏକ ଶହ"),
        ("+", 0, "5", "शून्य दशमलव पाँच", "शून्य दशांश पाच", "ଶୂନ୍ୟ ଦଶମିକ ପାଞ୍ଚ"),
        (
            "+", 3, "14",
            "तीन दशमलव एक चार",
            "तीन दशांश एक चार",
            "ତିନି ଦଶମିକ ଏକ ଚାରି",
        ),
        # Leading-zero fractional pronounces each digit (so 0.001 is
        # ``... point zero zero one``).
        (
            "+", 0, "001",
            "शून्य दशमलव शून्य शून्य एक",
            "शून्य दशांश शून्य शून्य एक",
            "ଶୂନ୍ୟ ଦଶମିକ ଶୂନ୍ୟ ଶୂନ୍ୟ ଏକ",
        ),
        # Negative + decimal.
        (
            "-", 2, "5",
            "ऋण दो दशमलव पाँच",
            "उणे दोन दशांश पाच",
            "ଋଣ ଦୁଇ ଦଶମିକ ପାଞ୍ଚ",
        ),
    ],
)
def test_spell_signed_decimal(
    sign: str,
    integer: int,
    fractional: str | None,
    hi: str,
    mr: str,
    or_: str,
) -> None:
    assert spell(sign, integer, fractional, "hi") == hi  # type: ignore[arg-type]
    assert spell(sign, integer, fractional, "mr") == mr  # type: ignore[arg-type]
    assert spell(sign, integer, fractional, "or") == or_  # type: ignore[arg-type]


# ----------------------------------------------------------------
# T-2.8a: number_forms — full integration for signed / decimal.
# ----------------------------------------------------------------


def test_number_forms_negative() -> None:
    nf = number_forms("-100")
    assert nf is not None
    assert nf.value == "-100"
    assert nf.digits_latin == "-100"
    assert nf.digits_deva == "-१००"
    assert nf.digits_orya == "-୧୦୦"
    # Spelled-out prefixes the language minus word.
    assert nf.hi.spelled.startswith("ऋण ")
    assert nf.mr.spelled.startswith("उणे ")
    assert nf.odia.spelled.startswith("ଋଣ ")


def test_number_forms_decimal() -> None:
    nf = number_forms("3.14")
    assert nf is not None
    assert nf.value == "3.14"
    assert nf.digits_latin == "3.14"
    assert nf.digits_deva == "३.१४"
    assert nf.digits_orya == "୩.୧୪"
    assert "दशमलव" in nf.hi.spelled
    assert "दशांश" in nf.mr.spelled
    assert "ଦଶମିକ" in nf.odia.spelled


def test_number_forms_negative_decimal() -> None:
    nf = number_forms("-2.5")
    assert nf is not None
    assert nf.value == "-2.5"
    assert nf.digits_latin == "-2.5"
    assert nf.hi.spelled == "ऋण दो दशमलव पाँच"
    assert nf.mr.spelled == "उणे दोन दशांश पाच"
    assert nf.odia.spelled == "ଋଣ ଦୁଇ ଦଶମିକ ପାଞ୍ଚ"


def test_number_forms_u2212_minus_sign() -> None:
    """U+2212 MINUS SIGN (the typographically correct minus, often
    produced by autoformatting word processors) is accepted alongside
    ASCII hyphen-minus and produces the same canonical wire form."""
    nf = number_forms("−5")
    assert nf is not None
    assert nf.value == "-5"
    assert nf.digits_latin == "-5"


def test_number_forms_decimal_preserves_leading_zeros() -> None:
    """``0.001`` round-trips with the leading zeros intact — that's
    why ``value`` is a string."""
    nf = number_forms("0.001")
    assert nf is not None
    assert nf.value == "0.001"
    assert nf.hi.spelled == "शून्य दशमलव शून्य शून्य एक"
