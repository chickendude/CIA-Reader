"""Yiddish lemma table for the custom pipeline.

Same role as :mod:`app.pipelines.odia.lemmas`: a tiny hand-curated seed
that exercises the morphology rules and drives the golden-file tests.
The large-scale import (Wiktionary Yiddish via Kaikki.org) populates
the Postgres ``lemmas`` table; this module only feeds the read-time
analyzer.

Two Yiddish-specific departures from the Odia table:

* **Citation forms vs stems.** Yiddish dictionaries cite verbs by the
  infinitive (שרײַבן), but conjugation works on the stem (שרײַב). A
  lemma may carry an explicit ``stem``; the table indexes both, and
  the analyzer reports the *headword* so reader lemmas line up with
  dictionary entries.
* **Explicit irregular forms.** Suppletive and ablaut forms (בין /
  איז / געווען for זײַן, געשריבן for שרײַבן, ביכער for בוך) can't be
  reached by suffix rules. An entry may list them under ``forms`` with
  their features; the analyzer checks that index before the rules.

Lookups are keyed by :func:`canonical_key`, which NFC-normalizes,
folds the Hebrew ligature codepoints (װ ױ ײ) to their two-letter
spellings, and normalizes the trailing letter to its final form.
Ligature folding matters because both spellings circulate in digital
Yiddish (Wiktionary uses ligatures, most typed text uses letter
pairs) and Unicode normalization deliberately leaves them distinct.
The final-letter fold lets a stem stripped out of a longer surface
(לערנ from לערנט, with a non-final nun) match the stored stem לערן.
"""

from __future__ import annotations

import json
import unicodedata
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

# U+05F0/F1/F2 are distinct codepoints with no canonical decomposition,
# so NFC leaves them alone — fold them manually.
_LIGATURE_FOLD = str.maketrans({"װ": "וו", "ױ": "וי", "ײ": "יי"})

_FINAL_BY_REGULAR: dict[str, str] = {
    "מ": "ם",
    "נ": "ן",
    "פ": "ף",
    "צ": "ץ",
    "כ": "ך",
}

_RAFE = "ֿ"  # U+05BF
_DAGESH = "ּ"  # U+05BC


_PASEKH = "ַ"  # U+05B7


def canonical_key(text: str) -> str:
    """Normalize a surface / headword / stem into its lookup key."""
    s = unicodedata.normalize("NFC", text).translate(_LIGATURE_FOLD)
    if not s:
        return s
    # Pasekh tsvey yudn has two letter-pair encodings in the wild:
    # pasekh on the second yud (canonical) or on the first. Fold the
    # first-yud variant so both hit the same key. The ligature
    # encoding was already folded to יי + pasekh by the translate.
    s = s.replace("י" + _PASEKH + "י", "יי" + _PASEKH)
    # Trailing pe: פֿ (fe, pe+rafe) finalizes to bare ף; פּ (pe+dagesh,
    # the [p] sound) has no final form and stays as typed.
    if s.endswith("פ" + _RAFE):
        return s[:-2] + "ף"
    if s.endswith("פ" + _DAGESH):
        return s
    last = s[-1]
    if last in _FINAL_BY_REGULAR:
        return s[:-1] + _FINAL_BY_REGULAR[last]
    return s


@dataclass(frozen=True, slots=True)
class YiddishForm:
    """One explicit (irregular / suppletive / umlaut) inflected form.

    ``romanization`` is the phonetic YIVO reading when the rule-based
    letter mapping would be wrong — chiefly loshn-koydesh plurals
    (חלומות → khaloymes). ``None`` defers to the rule-based output.
    """

    features: dict[str, str] = field(default_factory=dict)
    romanization: str | None = None


@dataclass(frozen=True, slots=True)
class YiddishLemma:
    """A minimal lemma record for the Yiddish seed table.

    ``headword`` is the dictionary citation form (infinitive for
    verbs); ``stem`` is the conjugation base when it differs from the
    headword. ``romanization`` is the headword's phonetic YIVO reading
    for words the rule-based mapping can't romanize — the unpointed
    loshn-koydesh vocabulary (שבת → shabes, not the letter-by-letter
    "shbs"). Richer fields live on the Postgres ``lemmas`` table.
    """

    headword: str
    pos: str
    gloss: str | None = None
    stem: str | None = None
    romanization: str | None = None
    # surface → explicit form record for forms the rules can't derive.
    forms: dict[str, YiddishForm] = field(default_factory=dict)


class YiddishLemmaTable:
    """Lookup wrapper with three indexes: headword, stem, irregular form."""

    def __init__(self, entries: list[YiddishLemma]) -> None:
        self._by_headword: dict[str, YiddishLemma] = {}
        self._by_stem: dict[str, list[YiddishLemma]] = {}
        self._by_form: dict[str, list[tuple[YiddishLemma, YiddishForm]]] = {}
        for lemma in entries:
            self._by_headword[canonical_key(lemma.headword)] = lemma
            if lemma.stem:
                self._by_stem.setdefault(canonical_key(lemma.stem), []).append(lemma)
            for surface, form in lemma.forms.items():
                self._by_form.setdefault(canonical_key(surface), []).append(
                    (lemma, form)
                )

    def lookup(self, surface: str) -> YiddishLemma | None:
        return self._by_headword.get(canonical_key(surface))

    def lookup_stem(self, stem: str) -> list[YiddishLemma]:
        return self._by_stem.get(canonical_key(stem), [])

    def lookup_form(
        self, surface: str
    ) -> list[tuple[YiddishLemma, YiddishForm]]:
        return self._by_form.get(canonical_key(surface), [])

    def __len__(self) -> int:
        return len(self._by_headword)

    def __contains__(self, surface: str) -> bool:
        return canonical_key(surface) in self._by_headword


_SEED_PATH = Path(__file__).parent / "data" / "seed_lemmas.json"


def load_seed_lemma_table(path: Path | None = None) -> YiddishLemmaTable:
    """Load the seed lemma table from a JSON file.

    ``path`` is overridable so tests can load a tiny custom fixture.
    """
    source = path if path is not None else _SEED_PATH
    raw = json.loads(source.read_text(encoding="utf-8"))
    entries: list[YiddishLemma] = []
    for headword, fields in raw.get("entries", {}).items():
        entries.append(
            YiddishLemma(
                headword=unicodedata.normalize("NFC", headword),
                pos=fields["pos"],
                gloss=fields.get("gloss"),
                stem=fields.get("stem"),
                romanization=fields.get("romanization"),
                forms={
                    surface: YiddishForm(
                        features=dict(form.get("features") or {}),
                        romanization=form.get("romanization"),
                    )
                    for surface, form in (fields.get("forms") or {}).items()
                },
            )
        )
    return YiddishLemmaTable(entries)


@lru_cache(maxsize=1)
def default_lemma_table() -> YiddishLemmaTable:
    """Cached default lemma table used by :func:`build_yiddish_pipeline`."""
    return load_seed_lemma_table()


__all__ = [
    "YiddishForm",
    "YiddishLemma",
    "YiddishLemmaTable",
    "canonical_key",
    "default_lemma_table",
    "load_seed_lemma_table",
]
