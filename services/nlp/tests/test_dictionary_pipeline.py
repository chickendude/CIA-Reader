"""Check the reader's saved-form lookups, including edits and ambiguous spellings."""

import os
import unicodedata
from contextlib import nullcontext

import psycopg
import pytest

from app.pipelines import dictionary, get_pipeline
from app.pipelines.dictionary import saved_matches


@pytest.mark.parametrize(
    ("language", "form", "root"),
    [
        ("eu", "etxeetan", "etxe"),
        ("mr", "घरात", "घर"),
        ("or", "ଘରେ", "ଘର"),
        ("yi", "הײַזער", "הויז"),
    ],
)
def test_saved_form_and_unknown_word(monkeypatch, language, form, root):
    key = unicodedata.normalize("NFC", form)
    calls = []

    def lookup(lang, words):
        calls.append((lang, words))
        return [(key, "root-id", root, "noun", {"Case": "Loc"}, "reading", 1)]

    monkeypatch.setattr(dictionary, "saved_matches", lookup)
    passage = f"{form} {form} {form}{form}!\n12"
    result = get_pipeline(language).process(passage)
    assert "".join(t.surface for t in result.tokens) == passage
    assert calls == [(language, [key, key + key])]
    saved, _, repeat, _, unknown, _, _, number = result.tokens
    assert repeat.candidates == saved.candidates
    assert saved.romanization == "reading"
    assert not saved.is_oov
    assert [(c.dictionary_id, c.lemma, c.features) for c in saved.candidates] == [
        ("root-id", root, {"Case": "Loc"})
    ]
    assert unknown.is_oov and unknown.candidates == []
    assert number.number_forms.digits_latin == "12"


@pytest.mark.skipif(
    not os.getenv("DICTIONARY_TEST_DATABASE_URL"), reason="requires migrated test DB"
)
def test_saved_forms_in_postgres(monkeypatch):
    url = os.environ["DICTIONARY_TEST_DATABASE_URL"]
    with psycopg.connect(url) as conn, conn.transaction(force_rollback=True):
        monkeypatch.setenv("DATABASE_URL", url)
        monkeypatch.setattr(dictionary, "saved_matches", saved_matches)
        # All lookups use this transaction so the sample entries roll back together.
        monkeypatch.setattr(psycopg, "connect", lambda _: nullcontext(conn))

        def add_root(headword, language="eu", attribution=None):
            return conn.execute(
                """INSERT INTO lemmas (language, headword, pos, script, source, source_attribution)
                   VALUES (%s, %s, 'noun', 'Latn', 'official_dictionary', %s) RETURNING id""",
                (language, headword, attribution),
            ).fetchone()[0]

        first = add_root("dictprobealpha")
        second = add_root("dictprobebeta")
        foreign = add_root("dictprobegamma", language="mr")
        add_root("dictprobelegacy", attribution="Stanza UD")
        for uid in (first, second, foreign):
            conn.execute(
                """INSERT INTO lemma_forms (lemma_id, surface, features, romanization)
                   VALUES (%s, 'dictprobecafé', '{"Number":"Plur"}', 'saved reading')""",
                (uid,),
            )
        pipeline = get_pipeline("eu")
        spelling = "dictprobecafe\u0301"
        hit = pipeline.process(spelling).tokens[0]
        assert hit.surface == spelling and hit.is_ambiguous
        assert {c.dictionary_id for c in hit.candidates} == {str(first), str(second)}
        assert hit.romanization == "saved reading"
        assert all(c.features == {"Number": "Plur"} for c in hit.candidates)
        assert pipeline.process("DICTPROBEALPHA").tokens[0].candidates[0].dictionary_id == str(
            first
        )
        assert pipeline.process("dictprobelegacy").tokens[0].is_oov

        conn.execute(
            """INSERT INTO form_lemma_overrides (chosen_lemma_id, language, surface_nfc)
               VALUES (%s, 'eu', 'dictprobecafé')""",
            (second,),
        )
        corrected = pipeline.process(spelling).tokens[0]
        assert [c.dictionary_id for c in corrected.candidates] == [str(second)]
        assert corrected.candidates[0].features == {"Number": "Plur"}
        conn.execute("DELETE FROM form_lemma_overrides WHERE chosen_lemma_id = %s", (second,))
        conn.execute(
            "UPDATE lemma_forms SET quarantined_at = now() WHERE lemma_id IN (%s, %s)",
            (first, second),
        )
        assert pipeline.process(spelling).tokens[0].is_oov

        conn.execute(
            """INSERT INTO dictionary_entries(lemma_id, external_id, entry)
               VALUES (%s, 'test:basque', '{"excluded_forms":["dictprobedropped"]}')""",
            (first,),
        )
        conn.execute(
            """INSERT INTO lemma_forms(lemma_id, surface)
               VALUES (%s, 'dictprobedropped'), (%s, 'dictprobealias')""",
            (first, second),
        )
        conn.execute(
            """INSERT INTO dictionary_pattern_forms(lemma_id, surface)
               VALUES (%s, 'dictprobealias'), (%s, 'dictprobealias zaharra')""",
            (first, first),
        )
        passage = "DICTPROBEALIAS  zaharra! dictprobedropped"
        result = pipeline.process(passage)
        assert "".join(token.surface for token in result.tokens) == passage
        assert {c.dictionary_id for c in result.tokens[0].candidates} == {str(first), str(second)}
        assert any(c.features.get("Compound") for c in result.tokens[0].candidates)
        assert not result.tokens[2].is_oov
        assert result.tokens[-1].is_oov
        assert not any(
            c.features.get("Compound")
            for c in pipeline.process("dictprobealias\nzaharra").tokens[0].candidates
        )
