"""Unit tests for :mod:`app.pipelines.odia.morph` (T-2.3a).

These tests pin down the rule-based analyzer's contract:

1. Exact-lemma match is the first reading returned.
2. Suffix rules only fire when the stripped stem resolves to a lemma
   AND the lemma's POS matches the rule's POS constraint.
3. Rules are applied longest-suffix-first, so compound suffixes like
   "ମାନଙ୍କୁ" (plural accusative) beat the shorter "କୁ".
4. Duplicate analyses (same lemma + same features) are de-duplicated.
5. ``rules()`` exposes the table sorted longest-first — so callers that
   iterate it (the pipeline and any future golden-file debuggers) can
   trust the ordering.
"""

from __future__ import annotations

from app.pipelines.odia.lemmas import OdiaLemma, OdiaLemmaTable
from app.pipelines.odia.morph import analyze, rules


def _table(**entries: OdiaLemma) -> OdiaLemmaTable:
    return OdiaLemmaTable(entries)


def test_no_lemma_no_rule_match_returns_empty():
    # Empty table, no suffix rule can fire either — pipeline will turn
    # this into is_oov=True.
    assert analyze("ଫ୍ଲର୍ବ", _table()) == []


def test_exact_lemma_match_returns_single_analysis_with_empty_features():
    lemma = OdiaLemma(headword="ଘର", pos="NOUN", gloss="house")
    out = analyze("ଘର", _table(ଘର=lemma))
    assert len(out) == 1
    assert out[0].lemma is lemma
    assert out[0].features == {}


def test_noun_locative_suffix_strips_to_stem():
    lemma = OdiaLemma(headword="ଘର", pos="NOUN")
    out = analyze("ଘରରେ", _table(ଘର=lemma))
    assert len(out) == 1
    assert out[0].lemma.headword == "ଘର"
    assert out[0].features == {"Case": "Loc"}


def test_noun_accusative_suffix_strips_to_stem():
    lemma = OdiaLemma(headword="ପିଲା", pos="NOUN")
    out = analyze("ପିଲାକୁ", _table(ପିଲା=lemma))
    assert out[0].features == {"Case": "Acc"}


def test_plural_suffix_wins_over_substring_singular_suffix():
    # "ପିଲାମାନଙ୍କୁ" ends with both "ମାନଙ୍କୁ" (Plur+Acc) AND "କୁ" (Acc).
    # Longest-first means the plural reading beats the singular.
    lemma = OdiaLemma(headword="ପିଲା", pos="NOUN")
    # Note "ପିଲାମାନଙ୍କ" is also a possible stem, but we haven't added
    # that as a lemma, so only "ପିଲା" + "ମାନଙ୍କୁ" matches.
    out = analyze("ପିଲାମାନଙ୍କୁ", _table(ପିଲା=lemma))
    # The plural reading must be present. Shorter-suffix readings
    # against the same stem are filtered out because they'd need a
    # *different* stem lookup ("ପିଲାମାନଙ୍କ") to match, and that stem
    # is not in the lemma table.
    assert any(
        a.features == {"Number": "Plur", "Case": "Acc"} for a in out
    )


def test_pos_constraint_filters_mismatched_lemma():
    # "କରରେ" ends with "ରେ" (NOUN+Loc). But "କର" in the table is a VERB,
    # so the rule's POS constraint must veto the match, leaving no
    # analyses.
    verb = OdiaLemma(headword="କର", pos="VERB")
    out = analyze("କରରେ", _table(କର=verb))
    assert out == []


def test_verb_future_third_person_suffix():
    lemma = OdiaLemma(headword="ଦେଖ", pos="VERB")
    out = analyze("ଦେଖିବେ", _table(ଦେଖ=lemma))
    assert any(a.features == {"Tense": "Fut", "Person": "3"} for a in out)


def test_verb_infinitive_suffix():
    # Consonant-final stem: "ିବା" strips cleanly to the stem. Vowel-final
    # stems like "ଖା" need a sandhi-inserted "ଇ" glide that the MVP rule
    # set deliberately doesn't model — those land in OOV until T-6.7
    # corrections teach the system the surface form.
    lemma = OdiaLemma(headword="ଦେଖ", pos="VERB")
    out = analyze("ଦେଖିବା", _table(ଦେଖ=lemma))
    assert any(a.features == {"VerbForm": "Inf"} for a in out)


def test_adjective_comparative_and_superlative():
    big = OdiaLemma(headword="ବଡ଼", pos="ADJ")
    out_cmp = analyze("ବଡ଼ତର", _table(ବଡ଼=big))
    out_sup = analyze("ବଡ଼ତମ", _table(ବଡ଼=big))
    assert any(a.features == {"Degree": "Cmp"} for a in out_cmp)
    assert any(a.features == {"Degree": "Sup"} for a in out_sup)


def test_exact_match_precedes_stripped_match_in_result_order():
    # "ଘରର" is itself in the lemma table AND also strips to ଘର+Gen via
    # the "ର" noun rule — so both analyses should appear, with the
    # exact reading first.
    base = OdiaLemma(headword="ଘର", pos="NOUN")
    compound = OdiaLemma(headword="ଘରର", pos="NOUN")
    out = analyze("ଘରର", _table(ଘର=base, ଘରର=compound))
    assert len(out) == 2
    assert out[0].lemma.headword == "ଘରର"
    assert out[0].features == {}
    assert out[1].lemma.headword == "ଘର"
    assert out[1].features == {"Case": "Gen"}


def test_duplicate_analyses_are_deduped():
    # An ADJ lemma that's also its own exact surface. The exact match
    # produces (ଭଲ, {}); no suffix rule should duplicate that reading.
    lemma = OdiaLemma(headword="ଭଲ", pos="ADJ")
    out = analyze("ଭଲ", _table(ଭଲ=lemma))
    assert len(out) == 1


def test_empty_stem_is_not_analyzed():
    # A surface identical to a suffix (e.g. surface == "ର") has an
    # empty stem after stripping — we must not attempt the lookup
    # (which would match against an empty-string key if one somehow
    # leaked into the table).
    lemma = OdiaLemma(headword="", pos="NOUN")
    out = analyze("ର", OdiaLemmaTable({"": lemma}))
    assert out == []


def test_rules_are_sorted_longest_first():
    # The pipeline depends on this ordering to resolve
    # plural-vs-singular overlaps — guard it with a direct check.
    lengths = [len(r.suffix) for r in rules()]
    assert lengths == sorted(lengths, reverse=True)


def test_nfc_insensitive_lookup_on_stripped_stem():
    # If the stem produced by suffix-stripping is in NFD form for any
    # reason, OdiaLemmaTable.lookup still re-normalizes, so the match
    # succeeds. This protects against subtle encoding drift in user
    # input that slipped past the /process NFC boundary.
    lemma = OdiaLemma(headword="ଘର", pos="NOUN")
    # Compose the surface from NFD pieces of ଘର, then add ରେ.
    import unicodedata
    nfd_ghar = unicodedata.normalize("NFD", "ଘର")
    surface = nfd_ghar + "ରେ"
    out = analyze(surface, _table(ଘର=lemma))
    assert any(a.features == {"Case": "Loc"} for a in out)
