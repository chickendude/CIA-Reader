"""Tests for the generated Yiddish loshn-koydesh lemma table.

The table itself is generated (scripts/build_loshn_koydesh.py); these
tests pin the loader contract and a few invariants of the committed
data — headword + inflected-form readings, the form → lemma linkage,
and that native words never leak in.
"""

from __future__ import annotations

from app.pipelines.yiddish.lemmas import YiddishLemma, YiddishLemmaTable
from app.pipelines.yiddish.loshn_koydesh import (
    load_loshn_koydesh_entries,
    loshn_koydesh_path,
)


def _table() -> YiddishLemmaTable:
    return YiddishLemmaTable(load_loshn_koydesh_entries())


def test_entries_load_and_are_nonempty():
    entries = load_loshn_koydesh_entries()
    assert len(entries) > 1000  # ~1.7k loan headwords at import time


def test_known_loan_headword_reading():
    lemma = _table().lookup("מחבר")
    assert lemma is not None
    assert lemma.pos == "NOUN"
    assert lemma.romanization == "mekhaber"


def test_headword_readings_for_common_loans():
    table = _table()
    for surface, expected in (("במשך", "bemeshekh"), ("כלב", "kelev"), ("תורה", "toyre")):
        lemma = table.lookup(surface)
        assert lemma is not None, surface
        assert lemma.romanization == expected


def test_inflected_form_links_to_root_with_reading():
    # The crux: the plural מחברים must resolve to lemma מחבר and carry the
    # curated reading "mekhabrem" (the rule mapping drops the vowels).
    matches = _table().lookup_form("מחברים")
    assert matches, "מחברים should be a known inflected form"
    lemma, form = matches[0]
    assert lemma.headword == "מחבר"
    assert form.features.get("Number") == "Plur"
    assert form.romanization == "mekhabrem"


def test_native_words_are_absent():
    # Native Germanic/Slavic words romanize correctly by rule, so the
    # generator must never have written them into the table.
    table = _table()
    for native in ("גייסט", "פֿינף", "וואַסער", "בוך"):
        assert table.lookup(native) is None
        assert table.lookup_form(native) == []


def test_lookup_folds_ligatures():
    # The table keys on canonical_key, which folds the U+05F2 ligature (ײ) to
    # the letter-pair (יי), so a word stored one way is found the other way.
    table = YiddishLemmaTable([YiddishLemma(headword="דרײַ", pos="NUM")])  # ligature
    assert table.lookup("דרײַ") is not None
    assert table.lookup("דרייַ") is not None  # letter-pair encoding


def test_committed_readings_are_clean():
    table = _table()
    for surface in ("מחבר", "במשך", "תורה"):
        lemma = table.lookup(surface)
        assert lemma and lemma.romanization
        assert lemma.romanization == lemma.romanization.strip()
        assert lemma.romanization.isascii()


def test_loshn_koydesh_path_points_at_committed_file():
    assert loshn_koydesh_path().name == "loshn_koydesh_lemmas.json"
    assert loshn_koydesh_path().exists()
