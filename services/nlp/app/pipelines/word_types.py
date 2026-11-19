import unicodedata

_SCRIPT_RANGES: dict[str, tuple[tuple[int, int], ...]] = {
    "Deva": ((0x0900, 0x097F),),
    "Orya": ((0x0B00, 0x0B7F),),
    # Hebrew block + Alphabetic Presentation Forms (ligature/pointed
    # variants that survive when input isn't NFC-normalized upstream).
    "Hebr": ((0x0590, 0x05FF), (0xFB1D, 0xFB4F)),
    # Basic Latin + Latin-1 Supplement + Latin Extended-A/B, covering
    # Basque's ç/ñ/ü and accented loanwords. Lets the foreign-script
    # filter drop non-Latin fragments
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
    return any(start <= ord(ch) <= end for ch in surface for start, end in ranges)


def _has_letter(surface: str) -> bool:
    return any(unicodedata.category(ch).startswith("L") for ch in surface)


def _looks_like_coordinate_part(surface: str) -> bool:
    """Keep coordinates such as 113°43 out of dictionary lookups."""
    return any(mark in surface for mark in _COORDINATE_MARKS)


def should_treat_as_word(surface: str, upos: str, *, script: str | None) -> bool:
    if upos in {"PUNCT", "SYM"}:
        return False
    if _looks_like_coordinate_part(surface):
        return False
    if upos == "NUM":
        return True
    if _has_letter(surface) and not _has_target_script(surface, script):
        return False
    return True
