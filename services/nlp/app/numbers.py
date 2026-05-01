"""Number-to-words for digit-only NUM tokens (T-2.8).

The reader pop-up calls :func:`number_forms` whenever it receives a
token whose surface is purely digits (Latin ``0–9``, Devanagari
``०–९``, or Odia ``୦–୯`` — all from one script). The result is a
:class:`NumberForms` struct with the integer value, all three native-
script digit renderings, and the spelled-out form + ISO 15919
romanization in each of the three MVP languages (Hindi, Marathi, Odia).

Range
=====
Integer-part values from 0 through 10⁷ (one crore) inclusive — the
sign-and-decimal extensions added in T-2.8a respect the same cap on
the integer part but accept an arbitrarily long fractional part
(each digit pronounced individually, English-style). Out-of-range
integer parts and unsupported shapes (mixed scripts, multiple decimal
points, lonely sign or decimal point) fall through.

Linguistic notes
================
The 0–99 forms in all three languages are highly irregular and were
hand-curated for this module. Curator review is part of T-2.8 sign-off
— typos in the rare 50–99 range (especially Marathi ``सत्त्याहत्तर``-style
sandhi clusters) are exactly the sort of thing easy to miss in code
review and obvious to a native reader. The base-100 / base-1k / lakh /
crore composition rules are language-specific:

* **Hindi** uses ``<digit> सौ <remainder>``: ``एक सौ तेईस``.
* **Marathi** fuses the hundreds digit and the hundred word into one
  token: ``एकशे तेवीस``. ``शंभर`` is colloquial for 100 alone, but
  ``एकशे`` keeps the decomposition grammar consistent so 100 and 105
  read as ``एकशे`` / ``एकशे पाच`` rather than alternating registers.
* **Odia** uses ``<digit> ଶହ <remainder>``: ``ଏକ ଶହ ତେଇଶ``.

All three languages stack lakh (10⁵) and crore (10⁷) above the base-1k
unit — a Western "million" reads as ``दस लाख``, not as a separate word.

Romanization is delegated to :func:`app.romanize.to_roman`, with the
language hint (``"hi"`` / ``"mr"`` / ``"or"``) so Hindi gets schwa
deletion and the ē/ō → e/o fold while Marathi and Odia keep the
macrons. The output scheme is fixed at ISO 15919 — the reader's
``romanization`` field is also ISO 15919, so the number block stays in
the same scheme as the rest of the popup.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Literal

from app.romanize import to_roman
from app.schemas import NumberForms, NumberLanguageForm

# ----------------------------------------------------------------
# Digit detection
# ----------------------------------------------------------------

_LATIN_DIGITS: str = "0123456789"
_DEVA_DIGITS: str = "०१२३४५६७८९"  # ०-९
_ORYA_DIGITS: str = "୦୧୨୩୪୫୬୭୮୯"  # ୦-୯

DigitScript = Literal["latin", "deva", "orya"]

_DIGIT_SETS: dict[DigitScript, str] = {
    "latin": _LATIN_DIGITS,
    "deva": _DEVA_DIGITS,
    "orya": _ORYA_DIGITS,
}

#: Inclusive upper bound on values this module accepts. One crore.
MAX_VALUE: int = 10_000_000


def _classify_script(surface: str) -> DigitScript | None:
    """Return the script tag if ``surface`` is non-empty and every
    character is a digit from one (and only one) of the supported
    scripts. Mixed-script and non-digit input returns ``None``.
    """
    if not surface:
        return None
    for name, digits in _DIGIT_SETS.items():
        if all(c in digits for c in surface):
            return name
    return None


def parse_digits(surface: str) -> int | None:
    """Parse a digit-only token (with optional thousands separators) to an int.

    Accepts Latin, Devanagari, or Odia digits; all digits must come
    from a single script. ASCII commas may appear as thousands /
    lakh separators — both Western (``1,000,000``) and Indian
    (``10,00,000``) grouping styles are accepted, since validating
    the precise grouping rule per locale is more friction than it's
    worth. Doubled commas, leading commas, and trailing commas are
    rejected so genuinely malformed input falls through.

    Returns ``None`` for empty input, mixed-script input, signed
    input, decimal input, or values exceeding :data:`MAX_VALUE`.
    """
    if not surface:
        return None
    # Comma-separator handling — reject obviously malformed positions
    # (`,123` / `123,` / `1,,234`) so a genuine non-number doesn't
    # collapse into a digit run.
    if "," in surface:
        if surface.startswith(",") or surface.endswith(",") or ",," in surface:
            return None
        surface = surface.replace(",", "")
        if not surface:
            return None
    script = _classify_script(surface)
    if script is None:
        return None
    digits = _DIGIT_SETS[script]
    value = 0
    for c in surface:
        value = value * 10 + digits.index(c)
    if value > MAX_VALUE:
        return None
    return value


def digits_in_script(n: int, script: DigitScript) -> str:
    """Render an integer as a string of digits in the given script.

    ``digits_in_script(123, "deva") == "१२३"``.
    """
    if n < 0 or n > MAX_VALUE:
        raise ValueError(f"{n} out of range [0, {MAX_VALUE}]")
    digits = _DIGIT_SETS[script]
    if n == 0:
        return digits[0]
    out: list[str] = []
    while n > 0:
        out.append(digits[n % 10])
        n //= 10
    return "".join(reversed(out))


# ----------------------------------------------------------------
# Hindi
# ----------------------------------------------------------------

# fmt: off
_HI_BELOW_100: tuple[str, ...] = (
    "शून्य",        # 0
    "एक",          # 1
    "दो",           # 2
    "तीन",         # 3
    "चार",         # 4
    "पाँच",         # 5
    "छह",          # 6
    "सात",         # 7
    "आठ",          # 8
    "नौ",           # 9
    "दस",          # 10
    "ग्यारह",       # 11
    "बारह",        # 12
    "तेरह",         # 13
    "चौदह",        # 14
    "पंद्रह",        # 15
    "सोलह",        # 16
    "सत्रह",        # 17
    "अठारह",       # 18
    "उन्नीस",       # 19
    "बीस",         # 20
    "इक्कीस",       # 21
    "बाईस",        # 22
    "तेईस",         # 23
    "चौबीस",       # 24
    "पच्चीस",       # 25
    "छब्बीस",       # 26
    "सत्ताईस",      # 27
    "अट्ठाईस",      # 28
    "उनतीस",       # 29
    "तीस",         # 30
    "इकतीस",       # 31
    "बत्तीस",       # 32
    "तैंतीस",        # 33
    "चौंतीस",       # 34
    "पैंतीस",        # 35
    "छत्तीस",       # 36
    "सैंतीस",        # 37
    "अड़तीस",       # 38
    "उनतालीस",     # 39
    "चालीस",       # 40
    "इकतालीस",     # 41
    "बयालीस",      # 42
    "तैंतालीस",      # 43
    "चौवालीस",     # 44
    "पैंतालीस",      # 45
    "छियालीस",     # 46
    "सैंतालीस",      # 47
    "अड़तालीस",     # 48
    "उनचास",       # 49
    "पचास",        # 50
    "इक्यावन",      # 51
    "बावन",        # 52
    "तिरेपन",       # 53
    "चौवन",        # 54
    "पचपन",        # 55
    "छप्पन",        # 56
    "सत्तावन",      # 57
    "अट्ठावन",      # 58
    "उनसठ",        # 59
    "साठ",         # 60
    "इकसठ",        # 61
    "बासठ",        # 62
    "तिरेसठ",       # 63
    "चौंसठ",        # 64
    "पैंसठ",         # 65
    "छियासठ",      # 66
    "सड़सठ",        # 67
    "अड़सठ",        # 68
    "उनहत्तर",      # 69
    "सत्तर",         # 70
    "इकहत्तर",      # 71
    "बहत्तर",        # 72
    "तिहत्तर",       # 73
    "चौहत्तर",       # 74
    "पचहत्तर",      # 75
    "छिहत्तर",      # 76
    "सतहत्तर",      # 77
    "अठहत्तर",      # 78
    "उन्यासी",       # 79
    "अस्सी",        # 80
    "इक्यासी",      # 81
    "बयासी",        # 82
    "तिरासी",       # 83
    "चौरासी",       # 84
    "पचासी",       # 85
    "छियासी",      # 86
    "सत्तासी",       # 87
    "अट्ठासी",      # 88
    "नवासी",       # 89
    "नब्बे",         # 90
    "इक्यानवे",     # 91
    "बानवे",        # 92
    "तिरानवे",      # 93
    "चौरानवे",      # 94
    "पचानवे",      # 95
    "छियानवे",     # 96
    "सत्तानवे",     # 97
    "अट्ठानवे",     # 98
    "निन्यानवे",    # 99
)
# fmt: on
assert len(_HI_BELOW_100) == 100

_HI_HUNDRED = "सौ"
_HI_THOUSAND = "हज़ार"
_HI_LAKH = "लाख"
_HI_CRORE = "करोड़"


def to_words_hi(n: int) -> str:
    """Spell out ``n`` in Hindi (Devanagari)."""
    if n < 0 or n > MAX_VALUE:
        raise ValueError(f"{n} out of range [0, {MAX_VALUE}]")
    if n < 100:
        return _HI_BELOW_100[n]

    parts: list[str] = []
    crores, n = divmod(n, 10_000_000)
    lakhs, n = divmod(n, 100_000)
    thousands, n = divmod(n, 1_000)
    hundreds, n = divmod(n, 100)
    if crores:
        parts.append(f"{_HI_BELOW_100[crores]} {_HI_CRORE}")
    if lakhs:
        parts.append(f"{_HI_BELOW_100[lakhs]} {_HI_LAKH}")
    if thousands:
        parts.append(f"{_HI_BELOW_100[thousands]} {_HI_THOUSAND}")
    if hundreds:
        parts.append(f"{_HI_BELOW_100[hundreds]} {_HI_HUNDRED}")
    if n:
        parts.append(_HI_BELOW_100[n])
    return " ".join(parts)


# ----------------------------------------------------------------
# Marathi
# ----------------------------------------------------------------

# fmt: off
_MR_BELOW_100: tuple[str, ...] = (
    "शून्य",        # 0
    "एक",          # 1
    "दोन",         # 2
    "तीन",         # 3
    "चार",         # 4
    "पाच",         # 5
    "सहा",         # 6
    "सात",         # 7
    "आठ",          # 8
    "नऊ",          # 9
    "दहा",         # 10
    "अकरा",        # 11
    "बारा",         # 12
    "तेरा",         # 13
    "चौदा",        # 14
    "पंधरा",        # 15
    "सोळा",        # 16
    "सतरा",        # 17
    "अठरा",        # 18
    "एकोणीस",      # 19
    "वीस",          # 20
    "एकवीस",       # 21
    "बावीस",       # 22
    "तेवीस",        # 23
    "चोवीस",       # 24
    "पंचवीस",      # 25
    "सव्वीस",       # 26
    "सत्तावीस",     # 27
    "अठ्ठावीस",     # 28
    "एकोणतीस",     # 29
    "तीस",         # 30
    "एकतीस",       # 31
    "बत्तीस",        # 32
    "तेहतीस",       # 33
    "चौतीस",       # 34
    "पस्तीस",       # 35
    "छत्तीस",       # 36
    "सदतीस",       # 37
    "अडतीस",       # 38
    "एकोणचाळीस",   # 39
    "चाळीस",       # 40
    "एक्केचाळीस",   # 41
    "बेचाळीस",      # 42
    "त्रेचाळीस",     # 43
    "चव्वेचाळीस",   # 44
    "पंचेचाळीस",    # 45
    "सेहेचाळीस",    # 46
    "सत्तेचाळीस",   # 47
    "अठ्ठेचाळीस",   # 48
    "एकोणपन्नास",  # 49
    "पन्नास",       # 50
    "एक्कावन्न",    # 51
    "बावन्न",       # 52
    "त्रेपन्न",       # 53
    "चोपन्न",       # 54
    "पंचावन्न",     # 55
    "छप्पन्न",      # 56
    "सत्तावन्न",    # 57
    "अठ्ठावन्न",    # 58
    "एकोणसाठ",    # 59
    "साठ",         # 60
    "एकसष्ठ",      # 61
    "बासष्ठ",       # 62
    "त्रेसष्ठ",       # 63
    "चौसष्ठ",       # 64
    "पासष्ठ",       # 65
    "सहासष्ठ",     # 66
    "सदुसष्ठ",      # 67
    "अडुसष्ठ",      # 68
    "एकोणसत्तर",   # 69
    "सत्तर",        # 70
    "एक्काहत्तर",   # 71
    "बाहत्तर",      # 72
    "त्र्याहत्तर",    # 73
    "चौऱ्याहत्तर",  # 74
    "पंच्याहत्तर",   # 75
    "शहात्तर",      # 76
    "सत्त्याहत्तर",  # 77
    "अठ्ठ्याहत्तर",  # 78
    "एकोणऐंशी",    # 79
    "ऐंशी",         # 80
    "एक्क्याऐंशी",  # 81
    "ब्याऐंशी",      # 82
    "त्र्याऐंशी",     # 83
    "चौऱ्याऐंशी",   # 84
    "पंच्याऐंशी",    # 85
    "शहाऐंशी",      # 86
    "सत्त्याऐंशी",   # 87
    "अठ्ठ्याऐंशी",   # 88
    "एकोणनव्वद",  # 89
    "नव्वद",       # 90
    "एक्क्याण्णव",  # 91
    "ब्याण्णव",     # 92
    "त्र्याण्णव",    # 93
    "चौऱ्याण्णव",   # 94
    "पंच्याण्णव",   # 95
    "शहाण्णव",     # 96
    "सत्त्याण्णव",  # 97
    "अठ्ठ्याण्णव",  # 98
    "नव्व्याण्णव",  # 99
)
# fmt: on
assert len(_MR_BELOW_100) == 100

# Marathi fuses the hundreds digit with the hundred-word: एकशे, दोनशे,
# तीनशे, .... Index 0 is unused.
_MR_HUNDREDS: tuple[str, ...] = (
    "",  # unused
    "एकशे",
    "दोनशे",
    "तीनशे",
    "चारशे",
    "पाचशे",
    "सहाशे",
    "सातशे",
    "आठशे",
    "नऊशे",
)
_MR_THOUSAND = "हजार"
_MR_LAKH = "लाख"
_MR_CRORE = "कोटी"


def to_words_mr(n: int) -> str:
    """Spell out ``n`` in Marathi (Devanagari)."""
    if n < 0 or n > MAX_VALUE:
        raise ValueError(f"{n} out of range [0, {MAX_VALUE}]")
    if n < 100:
        return _MR_BELOW_100[n]

    parts: list[str] = []
    crores, n = divmod(n, 10_000_000)
    lakhs, n = divmod(n, 100_000)
    thousands, n = divmod(n, 1_000)
    hundreds, n = divmod(n, 100)
    if crores:
        parts.append(f"{_MR_BELOW_100[crores]} {_MR_CRORE}")
    if lakhs:
        parts.append(f"{_MR_BELOW_100[lakhs]} {_MR_LAKH}")
    if thousands:
        parts.append(f"{_MR_BELOW_100[thousands]} {_MR_THOUSAND}")
    if hundreds:
        parts.append(_MR_HUNDREDS[hundreds])
    if n:
        parts.append(_MR_BELOW_100[n])
    return " ".join(parts)


# ----------------------------------------------------------------
# Odia
# ----------------------------------------------------------------

# fmt: off
_OR_BELOW_100: tuple[str, ...] = (
    "ଶୂନ୍ୟ",        # 0
    "ଏକ",          # 1
    "ଦୁଇ",         # 2
    "ତିନି",         # 3
    "ଚାରି",         # 4
    "ପାଞ୍ଚ",        # 5
    "ଛଅ",          # 6
    "ସାତ",         # 7
    "ଆଠ",          # 8
    "ନଅ",          # 9
    "ଦଶ",          # 10
    "ଏଗାର",        # 11
    "ବାର",         # 12
    "ତେର",         # 13
    "ଚଉଦ",         # 14
    "ପନ୍ଦର",        # 15
    "ଷୋହଳ",        # 16
    "ସତର",         # 17
    "ଅଠର",         # 18
    "ଊଣେଇଶ",      # 19
    "କୋଡ଼ିଏ",       # 20
    "ଏକୋଇଶ",       # 21
    "ବାଇଶ",        # 22
    "ତେଇଶ",       # 23
    "ଚବିଶ",         # 24
    "ପଚିଶ",         # 25
    "ଛବିଶ",         # 26
    "ସତାଇଶ",      # 27
    "ଅଠାଇଶ",      # 28
    "ଅଣତିରିଶ",     # 29
    "ତିରିଶ",         # 30
    "ଏକତିରିଶ",     # 31
    "ବତିଶ",        # 32
    "ତେତିଶ",       # 33
    "ଚଉତିରିଶ",     # 34
    "ପଞ୍ଚତିରିଶ",    # 35
    "ଛତିଶ",        # 36
    "ସଡ଼େଇତିରିଶ",   # 37
    "ଅଠତିରିଶ",     # 38
    "ଅଣଚାଳିଶ",     # 39
    "ଚାଳିଶ",       # 40
    "ଏକଚାଳିଶ",     # 41
    "ବୟାଳିଶ",      # 42
    "ତେୟାଳିଶ",     # 43
    "ଚଉରାଳିଶ",     # 44
    "ପଞ୍ଚଚାଳିଶ",   # 45
    "ଛୟାଳିଶ",      # 46
    "ସତଚାଳିଶ",     # 47
    "ଅଠଚାଳିଶ",     # 48
    "ଅଣଚାଶ",       # 49
    "ପଚାଶ",        # 50
    "ଏକାବନ",       # 51
    "ବାବନ",        # 52
    "ତେପନ",        # 53
    "ଚଉବନ",        # 54
    "ପଞ୍ଚାବନ",     # 55
    "ଛାବନ",        # 56
    "ସତାବନ",      # 57
    "ଅଠାବନ",      # 58
    "ଅଣଷଠି",       # 59
    "ଷାଠିଏ",        # 60
    "ଏକଷଠି",       # 61
    "ବାଷଠି",        # 62
    "ତେଷଠି",       # 63
    "ଚଉଷଠି",       # 64
    "ପଞ୍ଚଷଠି",     # 65
    "ଛଅଷଠି",       # 66
    "ସତଷଠି",       # 67
    "ଅଠଷଠି",       # 68
    "ଅଣସତୁରୀ",     # 69
    "ସତୁରୀ",        # 70
    "ଏକସତୁରୀ",     # 71
    "ବାସତୁରୀ",      # 72
    "ତେସତୁରୀ",     # 73
    "ଚଉସତୁରୀ",     # 74
    "ପଞ୍ଚସତୁରୀ",   # 75
    "ଛଅସତୁରୀ",     # 76
    "ସତସତୁରୀ",     # 77
    "ଅଠସତୁରୀ",     # 78
    "ଅଣାଅଶୀ",      # 79
    "ଅଶୀ",         # 80
    "ଏକାଅଶୀ",      # 81
    "ବୟାଅଶୀ",      # 82
    "ତିରାଅଶୀ",      # 83
    "ଚଉରାଅଶୀ",    # 84
    "ପଞ୍ଚାଅଶୀ",    # 85
    "ଛୟାଅଶୀ",      # 86
    "ସତାଅଶୀ",     # 87
    "ଅଠାଅଶୀ",     # 88
    "ଅଣାନବେ",     # 89
    "ନବେ",         # 90
    "ଏକାନବେ",     # 91
    "ବୟାନବେ",     # 92
    "ତିରାନବେ",     # 93
    "ଚଉରାନବେ",    # 94
    "ପଞ୍ଚାନବେ",   # 95
    "ଛୟାନବେ",     # 96
    "ସତାନବେ",     # 97
    "ଅଠାନବେ",     # 98
    "ଅନେଶତ",      # 99
)
# fmt: on
assert len(_OR_BELOW_100) == 100

_OR_HUNDRED = "ଶହ"
_OR_THOUSAND = "ହଜାର"
_OR_LAKH = "ଲକ୍ଷ"
_OR_CRORE = "କୋଟି"


def to_words_or(n: int) -> str:
    """Spell out ``n`` in Odia."""
    if n < 0 or n > MAX_VALUE:
        raise ValueError(f"{n} out of range [0, {MAX_VALUE}]")
    if n < 100:
        return _OR_BELOW_100[n]

    parts: list[str] = []
    crores, n = divmod(n, 10_000_000)
    lakhs, n = divmod(n, 100_000)
    thousands, n = divmod(n, 1_000)
    hundreds, n = divmod(n, 100)
    if crores:
        parts.append(f"{_OR_BELOW_100[crores]} {_OR_CRORE}")
    if lakhs:
        parts.append(f"{_OR_BELOW_100[lakhs]} {_OR_LAKH}")
    if thousands:
        parts.append(f"{_OR_BELOW_100[thousands]} {_OR_THOUSAND}")
    if hundreds:
        parts.append(f"{_OR_BELOW_100[hundreds]} {_OR_HUNDRED}")
    if n:
        parts.append(_OR_BELOW_100[n])
    return " ".join(parts)


# ----------------------------------------------------------------
# T-2.8a — sign + decimal extensions
# ----------------------------------------------------------------

#: Sign component of a parsed numeric token. Always populated even
#: for unsigned input (defaults to ``"+"``).
Sign = Literal["+", "-"]

#: Accepted minus characters: ASCII hyphen-minus and U+2212 MINUS SIGN.
#: Plus signs are not accepted — leading ``+`` falls through.
_NEG_SIGNS: tuple[str, ...] = ("-", "−")

#: ASCII full stop is the only accepted decimal point. The Devanagari
#: danda (U+0964) is sentence punctuation, not a decimal separator,
#: even when surrounded by Devanagari digits.
_DECIMAL_POINT: str = "."

# Per-language "minus" prefix for negatives. Curator-confirmed before
# T-2.8a sign-off — these are loanwords from Sanskrit ``ṛṇa`` (debt /
# negative) common in mathematical registers; ``-3`` in Hindi reads
# as ``ऋण तीन``.
_HI_NEG: str = "ऋण"
_MR_NEG: str = "उणे"
_OR_NEG: str = "ଋଣ"
_NEG_WORDS: dict[str, str] = {"hi": _HI_NEG, "mr": _MR_NEG, "or": _OR_NEG}

# Per-language "point" word for decimals. Curator-confirmed.
# Hindi/Marathi use Sanskrit-derived ``daśamlava`` / ``daśāṁśa``;
# Odia uses ``daśamika``. Each is the standard mathematical register.
_HI_POINT: str = "दशमलव"
_MR_POINT: str = "दशांश"
_OR_POINT: str = "ଦଶମିକ"
_POINT_WORDS: dict[str, str] = {"hi": _HI_POINT, "mr": _MR_POINT, "or": _OR_POINT}


def parse_number(surface: str) -> tuple[Sign, int, str | None] | None:
    """Parse a possibly signed and/or decimal numeric surface (T-2.8a).

    Returns ``(sign, integer, fractional)`` where:

    * ``sign`` is ``"+"`` for unsigned input, ``"-"`` when the surface
      begins with ASCII ``-`` or U+2212 MINUS SIGN.
    * ``integer`` is the absolute value of the integer part, bounded
      by :data:`MAX_VALUE`.
    * ``fractional`` is the fractional digits as a Latin-digit string
      (so ``"0.001"`` round-trips with the leading zeros intact), or
      ``None`` when no decimal point was present.

    Returns ``None`` for unparseable, mixed-script, or out-of-range
    input. ``1,000``-style thousands separators are out of scope here
    — the unsigned integer path with separators lives in
    :func:`parse_digits`. ``number_forms`` glues the two together.

    The decimal point is ASCII ``.`` only. Both the integer and
    fractional parts must each be non-empty and from a single script,
    and they must both be from the *same* script.
    """
    if not surface:
        return None

    # Sign — single optional leading minus, no leading plus, no
    # multiple sign characters.
    sign: Sign = "+"
    if surface[0] in _NEG_SIGNS:
        sign = "-"
        surface = surface[1:]
        if not surface:
            return None  # lonely "-" / "−"
    if any(c in _NEG_SIGNS for c in surface):
        return None  # "--1", "1-2", trailing "-", etc.

    # Comma-grouping is a separate path; reject here so misuse like
    # "-1,000" doesn't silently lose the negative.
    if "," in surface:
        return None

    # Decimal split. Decimal requires both sides to be non-empty.
    int_part_str: str
    frac_part_str: str | None
    if _DECIMAL_POINT in surface:
        if surface.count(_DECIMAL_POINT) > 1:
            return None  # "1.2.3"
        int_part_str, frac_part_str = surface.split(_DECIMAL_POINT)
        if not int_part_str or not frac_part_str:
            return None  # "1." / ".5"
    else:
        int_part_str = surface
        frac_part_str = None

    int_script = _classify_script(int_part_str)
    if int_script is None:
        return None
    if frac_part_str is not None:
        frac_script = _classify_script(frac_part_str)
        if frac_script is None or frac_script != int_script:
            return None  # mixed script across the decimal

    digits = _DIGIT_SETS[int_script]
    int_value = 0
    for c in int_part_str:
        int_value = int_value * 10 + digits.index(c)
    if int_value > MAX_VALUE:
        return None

    # Normalize the fractional part to Latin digits for canonical
    # storage, preserving any leading zeros ("0.001" -> "001").
    frac_normalized: str | None = None
    if frac_part_str is not None:
        frac_normalized = "".join(str(digits.index(c)) for c in frac_part_str)

    return (sign, int_value, frac_normalized)


def format_in_script(
    sign: Sign,
    integer: int,
    fractional: str | None,
    script: DigitScript,
) -> str:
    """Render a (possibly signed, possibly decimal) number in the
    target script's digits. Sign uses ASCII ``-``; decimal point uses
    ASCII ``.``. The fractional digits are mapped one-for-one — the
    Latin-digit canonical fractional ``"001"`` becomes ``"००१"`` in
    Devanagari, ``"୦୦୧"`` in Odia.
    """
    out = digits_in_script(integer, script)
    if fractional is not None:
        digits = _DIGIT_SETS[script]
        out = out + _DECIMAL_POINT + "".join(digits[int(c)] for c in fractional)
    if sign == "-":
        out = "-" + out
    return out


# ----------------------------------------------------------------
# Public entry point
# ----------------------------------------------------------------

_LANG_TO_SCRIPT: dict[str, str] = {"hi": "Deva", "mr": "Deva", "or": "Orya"}

# Per-language 0-9 spelled-out forms — used for fractional digit
# read-out (English "three point one four" style) so we don't repeat
# the trickier <100 forms here. Slicing the existing tables keeps the
# 0-9 source-of-truth in one place.
_FRAC_DIGIT_WORDS: dict[str, tuple[str, ...]] = {
    "hi": _HI_BELOW_100[:10],
    "mr": _MR_BELOW_100[:10],
    "or": _OR_BELOW_100[:10],
}

_INT_TO_WORDS: dict[str, Callable[[int], str]] = {
    "hi": to_words_hi,
    "mr": to_words_mr,
    "or": to_words_or,
}


def spell(
    sign: Sign,
    integer: int,
    fractional: str | None,
    language: str,
) -> str:
    """Spell out a (possibly signed, possibly decimal) number in the
    target language (T-2.8a). Format:

        [<minus-word>] <integer-words> [<point-word> <digit> ...]

    Negatives prefix the language's minus word (e.g. Hindi ``ऋण``).
    Decimals append the language's point word (e.g. Hindi ``दशमलव``)
    followed by each fractional digit pronounced individually — so
    ``-3.14`` in Hindi reads ``ऋण तीन दशमलव एक चार``.
    """
    parts: list[str] = []
    if sign == "-":
        parts.append(_NEG_WORDS[language])
    parts.append(_INT_TO_WORDS[language](integer))
    if fractional is not None:
        parts.append(_POINT_WORDS[language])
        digit_words = _FRAC_DIGIT_WORDS[language]
        for c in fractional:
            parts.append(digit_words[int(c)])
    return " ".join(parts)


def _romanize(spelled: str, language: str) -> str:
    return to_roman(
        spelled,
        from_script=_LANG_TO_SCRIPT[language],
        to_scheme="iso15919",
        language=language,
    )


def _language_form(spelled: str, language: str) -> NumberLanguageForm:
    return NumberLanguageForm(
        spelled=spelled,
        romanized=_romanize(spelled, language),
    )


def _canonical_value(sign: Sign, integer: int, fractional: str | None) -> str:
    """Canonical Latin-digit string for the wire ``value`` field.
    ``"-3.14"``, ``"0.001"``, ``"123"``."""
    base = str(integer) if fractional is None else f"{integer}.{fractional}"
    return f"-{base}" if sign == "-" else base


def _build_forms(sign: Sign, integer: int, fractional: str | None) -> NumberForms:
    return NumberForms(
        value=_canonical_value(sign, integer, fractional),
        digits_latin=format_in_script(sign, integer, fractional, "latin"),
        digits_deva=format_in_script(sign, integer, fractional, "deva"),
        digits_orya=format_in_script(sign, integer, fractional, "orya"),
        hi=_language_form(spell(sign, integer, fractional, "hi"), "hi"),
        mr=_language_form(spell(sign, integer, fractional, "mr"), "mr"),
        # Wire field is ISO 639-1 ``or``; Python attribute is ``odia``
        # (``or`` is a reserved keyword).
        odia=_language_form(spell(sign, integer, fractional, "or"), "or"),
    )


def number_forms(surface: str) -> NumberForms | None:
    """Build the per-language spelled-out + romanized struct for a
    numeric token, or ``None`` if the surface doesn't qualify.

    Two parsing paths feed into this:

    * :func:`parse_digits` — unsigned positive integers, optionally
      with thousands / lakh comma separators (``"1,000"``, ``"10,00,000"``).
      This path stays for backward compatibility with the chapter-
      processor's existing surfaces.
    * :func:`parse_number` (T-2.8a) — signed and/or decimal forms
      without separators (``"-12"``, ``"3.14"``, ``"-2.5"``).

    The two paths are tried in order; their accepted surface sets are
    disjoint by construction (parse_digits rejects sign / decimal,
    parse_number rejects commas) so the dispatch order doesn't matter
    for correctness.
    """
    simple_value = parse_digits(surface)
    if simple_value is not None:
        return _build_forms("+", simple_value, None)
    parsed = parse_number(surface)
    if parsed is None:
        return None
    return _build_forms(*parsed)


__all__ = [
    "MAX_VALUE",
    "DigitScript",
    "Sign",
    "digits_in_script",
    "format_in_script",
    "number_forms",
    "parse_digits",
    "parse_number",
    "spell",
    "to_words_hi",
    "to_words_mr",
    "to_words_or",
]
