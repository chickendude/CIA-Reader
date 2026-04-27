"""Unit tests for the morphology gloss formatter (T-2.4).

These tests target the reader-facing contract from the plan:

* Verbs compose person+number compactly ("3sg"), then gender, tense,
  aspect.
* Nouns compose number → gender → case.
* Adjectives lead with degree, then number/gender/case agreement.
* Punctuation / symbol tokens return a plain label.
* Unknown UD feature values fall through as-is rather than being
  silently dropped — better to show ``"Novel_feat"`` in the UI than to
  pretend we understood it.
"""

from __future__ import annotations

from app.gloss import format_gloss


def test_hindi_verb_3sg_fem_present_habitual():
    # The canonical example from the plan:
    # "boltī hai — 3sg fem present habitual of bolnā".
    out = format_gloss(
        pos="VERB",
        features={
            "Person": "3",
            "Number": "Sing",
            "Gender": "Fem",
            "Tense": "Pres",
            "Aspect": "Hab",
        },
        lemma="bolnā",
    )
    assert out == "3sg fem present habitual of bolnā"


def test_verb_past_3pl_no_gender():
    out = format_gloss(
        pos="VERB",
        features={"Person": "3", "Number": "Plur", "Tense": "Past"},
        lemma="ଦେଖ",
    )
    assert out == "3pl past of ଦେଖ"


def test_verb_infinitive():
    # VerbForm=Inf surfaces as "infinitive"; no person/number/tense for
    # a bare infinitive. "infinitive of <lemma>" reads cleanly.
    out = format_gloss(
        pos="VERB",
        features={"VerbForm": "Inf"},
        lemma="पढ़ना",
    )
    assert out == "infinitive of पढ़ना"


def test_verb_finite_form_is_not_appended():
    # VerbForm=Fin is redundant — the tense / aspect already conveys
    # finiteness — so it should not add a "finite" word to the gloss.
    out = format_gloss(
        pos="VERB",
        features={"Person": "1", "Number": "Sing", "Tense": "Pres", "VerbForm": "Fin"},
        lemma="बोलना",
    )
    assert out == "1sg present of बोलना"


def test_noun_plural_locative():
    out = format_gloss(
        pos="NOUN",
        features={"Number": "Plur", "Case": "Loc"},
        lemma="ଘର",
    )
    assert out == "pl locative of ଘର"


def test_noun_with_no_features_falls_back_to_pos_plus_lemma():
    out = format_gloss(pos="NOUN", features={}, lemma="ଦୁନିଆ")
    assert out == "noun ଦୁନିଆ"


def test_adjective_comparative():
    out = format_gloss(pos="ADJ", features={"Degree": "Cmp"}, lemma="ବଡ଼")
    assert out == "comparative of ବଡ଼"


def test_adjective_positive_degree_is_elided():
    # Degree=Pos is the default and doesn't need to be shown. The
    # adjective should just render as "adjective <lemma>".
    out = format_gloss(pos="ADJ", features={"Degree": "Pos"}, lemma="ଭଲ")
    assert out == "adjective ଭଲ"


def test_punctuation_returns_plain_label():
    out = format_gloss(pos="PUNCT", features={}, lemma="।")
    assert out == "punctuation"


def test_unknown_pos_returns_lowered_pos_label():
    # Not in _POS_LABEL → fall back to lowercased UD tag rather than
    # erroring. The reader pop-up should still render something.
    out = format_gloss(pos="NOVELPOS", features={}, lemma="foo")
    assert out == "novelpos foo"


def test_missing_lemma_and_no_features_returns_pos_only():
    # OOV content words without a lemma still get a gloss string
    # (the UI will prefer the surface as a fallback alongside this).
    out = format_gloss(pos="NOUN", features={}, lemma=None)
    assert out == "noun"


def test_missing_pos_defaults_to_x():
    out = format_gloss(pos=None, features={}, lemma="something")
    assert out == "unknown word something"


def test_unknown_ud_value_passes_through_verbatim():
    # We shouldn't silently drop a feature value we don't know — better
    # to show the raw UD token than to lie to the reader.
    out = format_gloss(
        pos="VERB",
        features={"Person": "4", "Number": "Sing", "Tense": "Past"},
        lemma="test",
    )
    # "4sg past of test" — "4" isn't in _PERSON so it passes through.
    assert out == "4sg past of test"


def test_proper_noun_uses_same_slot_order_as_noun():
    # PROPN shares the noun template; the label changes to "proper noun".
    out = format_gloss(
        pos="PROPN",
        features={"Number": "Sing", "Case": "Nom"},
        lemma="Kolkata",
    )
    assert out == "sg nominative of Kolkata"


def test_noun_gender_slot():
    # Gender between number and case: "sg fem locative of X".
    out = format_gloss(
        pos="NOUN",
        features={"Number": "Sing", "Gender": "Fem", "Case": "Loc"},
        lemma="बोली",
    )
    assert out == "sg fem locative of बोली"


def test_adjective_agreement_with_number_and_case():
    # ADJ with comparative degree AND agreement features shows all slots.
    out = format_gloss(
        pos="ADJ",
        features={"Degree": "Cmp", "Number": "Sing", "Case": "Nom"},
        lemma="big",
    )
    assert out == "comparative sg nominative of big"


def test_verb_imperative_mood_and_passive_voice():
    # Covers Mood + Voice slots, both optional and rarely populated
    # together but individually common (imperatives, passives).
    out = format_gloss(
        pos="VERB",
        features={
            "Person": "2",
            "Number": "Sing",
            "Mood": "Imp",
            "Voice": "Pass",
        },
        lemma="read",
    )
    assert out == "2sg imperative passive of read"


def test_verb_person_without_number():
    # Person alone (e.g. an imperative with no explicit number) still
    # produces a readable "3 of <lemma>" gloss.
    out = format_gloss(
        pos="VERB", features={"Person": "3"}, lemma="do"
    )
    assert out == "3 of do"


def test_verb_number_without_person():
    # Plural-only marking (e.g. some nominalized forms) shouldn't be
    # dropped on the floor.
    out = format_gloss(
        pos="VERB", features={"Number": "Plur"}, lemma="do"
    )
    assert out == "pl of do"


def test_gloss_without_lemma_returns_body_alone():
    # When a feature set is populated but the lemma is missing (e.g.
    # a test double with partial data), we should still return the
    # feature-body string rather than nothing.
    out = format_gloss(
        pos="VERB",
        features={"Person": "3", "Number": "Sing", "Tense": "Pres"},
        lemma=None,
    )
    assert out == "3sg present"
