from uuid import NAMESPACE_URL, uuid5

from app.pipelines.hindidb import HindiDBPipeline
from hindidb.lexicon import Lexicon
from hindidb.parser import analyze


class Provider:
    def __init__(self, entries):
        self.lexicon = Lexicon(documents=[{"entries": entries}])
        self.ids = {key: str(uuid5(NAMESPACE_URL, key)) for key in self.lexicon.entries}

    def load(self):
        return self.lexicon, self.ids, 7


def entry(lemma, pos, **kwargs):
    return {"lemma": lemma, "pos": pos, "paradigm": "invariant", **kwargs}


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
