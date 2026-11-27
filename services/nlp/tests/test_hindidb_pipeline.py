import json
from unittest.mock import MagicMock
from uuid import NAMESPACE_URL, uuid4, uuid5

import psycopg

from app.pipelines.hindidb import HindiDBPipeline
from hindidb.lexicon import Lexicon, lexical_id
from hindidb.parser import analyze
from hindidb.review_reports import spelling_rows
from parhiba_hindi.database import DatabaseLexicon


class Provider:
    def __init__(self, entries):
        self.lexicon = Lexicon(documents=[{"entries": entries}])
        self.ids = {key: str(uuid5(NAMESPACE_URL, key)) for key in self.lexicon.entries}

    def load(self):
        return self.lexicon, self.ids, 7


def entry(lemma, pos, **kwargs):
    return {"lemma": lemma, "pos": pos, "paradigm": "invariant", **kwargs}


def test_stored_homographs_keep_their_own_ids_and_forms(monkeypatch):
    native, loan = uuid4(), uuid4()
    native_key = lexical_id("मिस", "NOUN")
    loan_key = f"parhiba:{loan}"
    conn = MagicMock()
    conn.execute.return_value.fetchone.return_value = (7,)
    conn.execute.return_value.fetchall.return_value = [
        (native, native_key, "मिस", "NOUN", {}, []),
        (loan, loan_key, "मिस", "NOUN", {"english_loan": True}, ["मिसें"]),
    ]
    monkeypatch.setenv("DATABASE_URL", "test")
    monkeypatch.setattr(psycopg, "connect", lambda _: conn)
    conn.__enter__.return_value = conn

    result = HindiDBPipeline(DatabaseLexicon()).process("मिस ग्रेंजर मिसें")
    shared, *_, inflected = result.tokens
    assert shared.is_ambiguous
    assert {c.dictionary_id for c in shared.candidates} == {str(native), str(loan)}
    assert {c.pos for c in shared.candidates} == {"NOUN"}
    assert [c.dictionary_id for c in inflected.candidates] == [str(loan)]
    assert len(result.hindi_analysis["occurrences"]) == 3


def test_spelling_redirect_with_two_same_pos_destinations_requires_review():
    lexicon = Lexicon(documents=[{"entries": [
        entry("राज", "NOUN", definitions=[{"original": "nuqtaless form of राज़"}]),
        entry("राज़", "NOUN", dictionary_id="first", definitions=[{"original": "first"}]),
        entry("राज़", "NOUN", dictionary_id="second", definitions=[{"original": "second"}]),
    ]}])
    report = spelling_rows(lexicon)
    assert not report["ready"]
    assert [row["lemma"] for row in report["skipped"]] == ["राज"]


def test_all_candidates_and_compounds_match_hindidb_without_doubling_source_words():
    provider = Provider(
        [
            entry("खाना", "NOUN"),
            entry("खाना", "VERB"),
            entry("हाथ", "NOUN"),
            entry("उठाना", "VERB", forms=["उठाया"]),
            entry("हाथ उठाना", "VERB", forms=["हाथ उठाया"]),
        ]
    )
    text = "खाना  हाथ उठाया।\n"
    actual = HindiDBPipeline(provider).process(text)
    expected = analyze(text, provider.lexicon)
    assert "".join(t.surface for t in actual.tokens) == text
    assert actual.hindi_analysis["stats"] == expected["stats"]
    assert actual.hindi_analysis["stats"]["source_words"] == 3
    assert len(actual.hindi_analysis["occurrences"]) == 5
    first = actual.tokens[0]
    assert first.is_ambiguous
    assert {c.pos for c in first.candidates} == {"NOUN", "VERB"}
    assert len({c.dictionary_id for c in first.candidates}) == 2
    assert all(c.score == 1 for c in first.candidates)
    for match, original in zip(
        actual.hindi_analysis["occurrences"], expected["occurrences"], strict=True
    ):
        assert text[match["source_start"] : match["source_end"]] == original["surface"]


def test_excluded_forms_nukta_variants_and_unresolved_gaps_survive_adapter():
    provider = Provider([entry("पढ़ना", "VERB", forms=["पढ़ा"], excluded_forms=["पढ़ा"])])
    text = "पढ़ा पढा अज्ञात १२ 🙂"
    result = HindiDBPipeline(provider).process(text)
    assert result.hindi_analysis["stats"]["unresolved_occurrences"] == 3
    assert result.hindi_analysis["stats"]["source_words"] == 3
    assert "".join(t.surface for t in result.tokens) == text


def test_negated_phrase_uses_the_saved_headword_in_the_reader():
    provider = Provider([
        entry("साथ छोड़ना", "VERB"),
        entry("साथ", "NOUN"), entry("न", "PART"),
        entry("छोड़ना", "VERB", paradigm="verb_consonant"),
        entry("देना", "VERB", forms=["दें"]),
    ])
    text = "वह आशा कर रहा था कि उसके घुटने उसका साथ न छोड़ दें।"
    result = HindiDBPipeline(provider).process(text)
    assert "".join(token.surface for token in result.tokens) == text
    spans = {
        (item["lemma_id"], text[item["source_start"]:item["source_end"]]): item["rules"]
        for item in result.hindi_analysis["occurrences"]
    }
    for lemma, pos, surface in [
        ("साथ", "NOUN", "साथ"), ("न", "PART", "न"),
        ("छोड़ना", "VERB", "छोड़"), ("देना", "VERB", "दें"),
    ]:
        assert (provider.ids[lexical_id(lemma, pos)], surface) in spans
    assert "phrase:negation" in spans[provider.ids[lexical_id("साथ छोड़ना", "VERB")], "साथ न छोड़"]


def test_negation_requires_a_verb_slot_and_respects_exclusions_and_literal_entries():
    lexicon = Provider([
        entry("ध्यान देना", "VERB", forms=["ध्यान दिया", "ध्यान न दिया"],
              excluded_forms=["ध्यान दीजिए", "ध्यान नहीं दें"]),
        entry("देना", "VERB", forms=["दिया", "दें", "दीजिए"]),
        entry("ध्यान देना", "NOUN"),
        entry("ध्यान न देना", "VERB"),
    ]).lexicon
    text = ("ध्यान दिया। ध्यान न दिया। ध्यान नहीं दिया। ध्यान न दें। ध्यान नहीं दें। "
            "ध्यान न दीजिए। ध्यान न न दिया। ध्यान, न दिया। ध्यान नहीं। दिया। "
            "ध्यान न ही दिया। ध्यान न देना।")
    matches = analyze(text, lexicon)["occurrences"]
    positives = [m for m in matches if m["entry_id"] == lexical_id("ध्यान देना", "VERB")]
    assert [m["surface"] for m in positives] == [
        "ध्यान दिया", "ध्यान न दिया", "ध्यान नहीं दिया", "ध्यान न दें", "ध्यान न देना",
    ]
    assert positives[1]["rules"] == ["explicit-form"]
    assert all(m["entry_id"] != lexical_id("ध्यान देना", "NOUN") for m in matches)
    assert [m["surface"] for m in matches if m["entry_id"] == lexical_id("ध्यान न देना", "VERB")] == [
        "ध्यान न देना"
    ]


def test_phrase_inherits_updates_to_the_final_verb_without_editing_the_phrase(tmp_path):
    lexicon = Provider([
        entry("ध्यान देना", "VERB"), entry("देना", "VERB", forms=["दिया"]),
    ]).lexicon
    path = tmp_path / "override.json"
    path.write_text(json.dumps({"entries": [entry("देना", "VERB", forms=["दें"])]}))
    updated = lexicon.extended(path)
    passage = "ध्यान न दें। ध्यान नहीं दिया।"
    for source, expected in [(lexicon, "ध्यान नहीं दिया"), (updated, "ध्यान न दें")]:
        [phrase] = [m for m in analyze(passage, source)["occurrences"] if m["compound"]]
        assert phrase["surface"] == expected


def test_grammatical_constructions_do_not_become_vocabulary_occurrences():
    provider = Provider(
        [entry("कर देना", "VERB", forms=["कर दिया"], vocabulary_role="construction")]
    )
    result = HindiDBPipeline(provider).process("कर दिया")
    assert result.hindi_analysis["occurrences"] == []
    assert len(result.hindi_analysis["constructions"]) == 1


def test_hidden_headword_matches_its_inflections_and_is_omitted_from_display():
    noun = entry("क़ब्ज़ा", "NOUN", paradigm="noun_m_aa",
                 alternative_headwords=["कब्जा", "कब्ज़ा"], hidden_alternative_headwords=["कब्जा"])
    analysis = analyze("कब्जा कब्जे कब्जों", Provider([noun]).lexicon)
    [row] = analysis["frequencies"]
    assert row["lemma"] == "क़ब्ज़ा"
    assert row["alternative_headwords"] == ["कब्ज़ा"]
    assert row["forms"] == {"कब्जा": 1, "कब्जे": 1, "कब्जों": 1}


def test_original_joiners_and_unicode_offsets_are_preserved():
    provider = Provider([entry("किताब", "NOUN")])
    text = "🙂 कि\u200dताब\nकिताब"
    result = HindiDBPipeline(provider).process(text)
    assert "".join(t.surface for t in result.tokens) == text
    assert len(result.hindi_analysis["occurrences"]) == 2
    assert result.hindi_analysis["occurrences"][0]["source_start"] == 2


def test_citation_numbers_devanagari_year_and_percentage_have_hindi_readings():
    provider = Provider([entry("में", "ADP")])
    text = "[9][10] २०११ में ५७.१%"
    result = HindiDBPipeline(provider).process(text)
    assert "".join(t.surface for t in result.tokens) == text
    numbers = {t.surface: t for t in result.tokens if t.number_forms}
    assert set(numbers) == {"9", "10", "२०११", "५७.१%"}
    assert numbers["9"].number_forms.hi.spelled == "नौ"
    assert numbers["10"].number_forms.hi.spelled == "दस"
    assert numbers["२०११"].number_forms.hi.spelled.endswith("ग्यारह")
    assert numbers["५७.१%"].number_forms.hi.spelled == "सत्तावन दशमलव एक प्रतिशत"
    assert all(not t.is_word for t in numbers.values())
    assert result.hindi_analysis["stats"]["source_words"] == 1
