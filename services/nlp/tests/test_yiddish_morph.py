"""Yiddish morphological analyzer unit tests.

Covers the lookup normalization (ligature folding + final letters),
each rule family (verb suffixes, the גע־ circumfix, noun plurals,
adjective agreement), the explicit irregular-forms index, and the
POS constraints that keep rules from over-generating.
"""

from __future__ import annotations

from app.pipelines.yiddish.lemmas import (
    YiddishForm,
    YiddishLemma,
    YiddishLemmaTable,
    canonical_key,
    default_lemma_table,
)
from app.pipelines.yiddish.morph import analyze


def _table(*entries: YiddishLemma) -> YiddishLemmaTable:
    return YiddishLemmaTable(list(entries))


# ---- canonical_key ----


def test_canonical_key_folds_ligatures():
    # U+05F0/F1/F2 vs the two-letter spellings — both circulate in
    # digital Yiddish and NFC keeps them distinct.
    assert canonical_key("װאַסער") == canonical_key("וואַסער")
    assert canonical_key("הױז") == canonical_key("הויז")
    assert canonical_key("צװײ") == canonical_key("צוויי")


def test_canonical_key_normalizes_final_letters():
    # A stem stripped out of a longer surface ends in a non-final
    # letter; the stored stem uses the final form.
    assert canonical_key("לערנ") == canonical_key("לערן")
    assert canonical_key("קומ") == canonical_key("קום")
    # Trailing fe (pe+rafe) finalizes to bare ף…
    assert canonical_key("קויפֿ") == canonical_key("קויף")
    # …but pe+dagesh ([p]) has no final form and must NOT collapse.
    assert canonical_key("קאַפּ") != canonical_key("קאַף")


def test_canonical_key_empty_string():
    assert canonical_key("") == ""


# ---- exact + stem + forms lookups ----


def test_exact_headword_match():
    table = _table(YiddishLemma(headword="בוך", pos="NOUN"))
    analyses = analyze("בוך", table)
    assert len(analyses) == 1
    assert analyses[0].lemma.headword == "בוך"
    assert analyses[0].features == {}


def test_bare_stem_resolves_to_citation_form():
    table = _table(YiddishLemma(headword="שרײַבן", pos="VERB", stem="שרײַב"))
    analyses = analyze("שרײַב", table)
    assert len(analyses) == 1
    assert analyses[0].lemma.headword == "שרײַבן"
    assert analyses[0].features["Person"] == "1"


def test_irregular_form_lookup():
    table = _table(
        YiddishLemma(
            headword="זייַן",
            pos="VERB",
            stem="זייַ",
            forms={
                "איז": YiddishForm(
                    features={"Tense": "Pres", "Person": "3", "Number": "Sing"}
                )
            },
        )
    )
    analyses = analyze("איז", table)
    assert len(analyses) == 1
    assert analyses[0].lemma.headword == "זייַן"
    assert analyses[0].features["Person"] == "3"


# ---- loshn-koydesh phonetic readings ----


def test_headword_phonetic_romanization():
    table = _table(
        YiddishLemma(headword="שבת", pos="NOUN", romanization="shabes")
    )
    analyses = analyze("שבת", table)
    assert len(analyses) == 1
    assert analyses[0].romanization == "shabes"


def test_form_phonetic_romanization():
    table = _table(
        YiddishLemma(
            headword="חלום",
            pos="NOUN",
            romanization="kholem",
            forms={
                "חלומות": YiddishForm(
                    features={"Number": "Plur"}, romanization="khaloymes"
                )
            },
        )
    )
    analyses = analyze("חלומות", table)
    assert len(analyses) == 1
    assert analyses[0].lemma.headword == "חלום"
    assert analyses[0].romanization == "khaloymes"


def test_rule_derived_analysis_has_no_phonetic():
    # Germanic-component inflection derived by rules carries no
    # phonetic — the rule-based romanizer is correct there.
    table = _table(YiddishLemma(headword="קינד", pos="NOUN"))
    analyses = analyze("קינדער", table)
    assert analyses[0].romanization is None


# ---- verb suffix rules ----


def test_verb_2sg_suffix():
    table = _table(YiddishLemma(headword="שרײַבן", pos="VERB", stem="שרײַב"))
    analyses = analyze("שרײַבסט", table)
    assert len(analyses) == 1
    assert analyses[0].lemma.headword == "שרײַבן"
    assert analyses[0].features == {
        "Tense": "Pres",
        "Person": "2",
        "Number": "Sing",
    }


def test_verb_suffix_with_final_letter_fold():
    # לערנט strips to לערנ (non-final nun) which must match stem לערן.
    table = _table(YiddishLemma(headword="לערנען", pos="VERB", stem="לערן"))
    analyses = analyze("לערנט", table)
    assert [a.lemma.headword for a in analyses] == ["לערנען"]


def test_infinitive_is_ambiguous_with_plural_present():
    # שרײַבן = exact headword AND stem + ־ן (1pl/3pl present).
    table = _table(YiddishLemma(headword="שרײַבן", pos="VERB", stem="שרײַב"))
    analyses = analyze("שרײַבן", table)
    assert len(analyses) == 2
    # Exact match orders first so candidates[0] is the citation form.
    assert analyses[0].features == {}


def test_circumfix_weak_participle():
    table = _table(YiddishLemma(headword="לערנען", pos="VERB", stem="לערן"))
    analyses = analyze("געלערנט", table)
    assert len(analyses) == 1
    assert analyses[0].lemma.headword == "לערנען"
    assert analyses[0].features == {"VerbForm": "Part"}


def test_circumfix_requires_stem_match():
    # געשריבן ablauts (שריב ≠ שרײַב) — the circumfix rule must NOT
    # fire; without a forms entry the surface is unanalyzable.
    table = _table(YiddishLemma(headword="שרײַבן", pos="VERB", stem="שרײַב"))
    assert analyze("געשריבן", table) == []


# ---- noun rules ----


def test_noun_plural_suffixes():
    table = _table(
        YiddishLemma(headword="קינד", pos="NOUN"),
        YiddishLemma(headword="טאַטע", pos="NOUN"),
        YiddishLemma(headword="חבֿר", pos="NOUN"),
    )
    for surface, headword in (
        ("קינדער", "קינד"),
        ("טאַטעס", "טאַטע"),
        ("חבֿרים", "חבֿר"),
    ):
        analyses = analyze(surface, table)
        assert [a.lemma.headword for a in analyses] == [headword], surface
        assert analyses[0].features == {"Number": "Plur"}


def test_noun_rule_pos_constrained():
    # דאָס strips ־ס to דאָ, but דאָ is an ADV — the NOUN rule must not
    # produce an analysis.
    table = _table(
        YiddishLemma(headword="דאָ", pos="ADV"),
        YiddishLemma(headword="דאָס", pos="DET"),
    )
    analyses = analyze("דאָס", table)
    assert [a.lemma.pos for a in analyses] == ["DET"]


# ---- adjective rules ----


def test_adjective_agreement_attaches_to_root():
    table = _table(YiddishLemma(headword="גוט", pos="ADJ"))
    for surface in ("גוטער", "גוטע", "גוטן", "גוטעם"):
        analyses = analyze(surface, table)
        assert [a.lemma.headword for a in analyses] == ["גוט"], surface
        # Endings cover several cells (and ־ער doubles as comparative),
        # so no features are asserted.
        assert analyses[0].features == {}


def test_unknown_surface_returns_no_analyses():
    table = _table(YiddishLemma(headword="בוך", pos="NOUN"))
    assert analyze("קאָמפּיוטער", table) == []


# ---- seed integrity ----


def test_seed_table_loads_and_covers_all_pos_families():
    table = default_lemma_table()
    assert len(table) >= 40
    assert "שרײַבן" in table
    assert "בוך" in table
    # Ligature-folded lookups hit the same rows.
    assert "שרײַבן".replace("ײ", "יי") in table
