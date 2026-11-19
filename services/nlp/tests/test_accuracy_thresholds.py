from __future__ import annotations

from pathlib import Path

import pytest

from app.eval import evaluate
from app.eval.corpus import load_corpus
from app.pipelines.hindidb import HindiDBPipeline
from app.pipelines.odia import OdiaPipeline
from app.pipelines.odia.lemmas import default_lemma_table
from app.pipelines.yiddish import build_yiddish_pipeline
from hindidb.lexicon import SEED, Lexicon

_GOLDEN_DIR = Path(__file__).resolve().parent / "golden"
_HINDI_CORPUS = _GOLDEN_DIR / "hindi_corpus.json"
_MARATHI_CORPUS = _GOLDEN_DIR / "marathi_corpus.json"
_BASQUE_CORPUS = _GOLDEN_DIR / "basque_corpus.json"
_ODIA_CORPUS = (
    Path(__file__).resolve().parent.parent
    / "app"
    / "pipelines"
    / "odia"
    / "data"
    / "golden_corpus.json"
)
_YIDDISH_CORPUS = (
    Path(__file__).resolve().parent.parent
    / "app"
    / "pipelines"
    / "yiddish"
    / "data"
    / "golden_corpus.json"
)

HINDI_LEMMA_FLOOR = 0.90
ODIA_LEMMA_FLOOR = 0.70
# Yiddish ships the same custom-pipeline tier as Odia: rule-based
# morphology over a seed table, with the unpointed loshn-koydesh
# vocabulary as the known weak spot.
YIDDISH_LEMMA_FLOOR = 0.70
# ---- corpus-structure sanity (default suite) ----


@pytest.mark.parametrize(
    "path",
    [_HINDI_CORPUS, _MARATHI_CORPUS, _ODIA_CORPUS, _YIDDISH_CORPUS, _BASQUE_CORPUS],
    ids=["hindi", "marathi", "odia", "yiddish", "basque"],
)
def test_corpus_loads_and_has_unique_ids(path: Path):
    corpus = load_corpus(path)
    assert len(corpus) > 0, f"{path.name} is empty"
    ids = [s.id for s in corpus.sentences]
    assert len(ids) == len(set(ids)), (
        f"{path.name} has duplicate sentence ids — merge them instead of duplicating"
    )
    # Every sentence must have at least one token, otherwise the eval
    # harness quietly scores it as a no-op and the corpus stops catching
    # regressions.
    for sentence in corpus.sentences:
        assert len(sentence.tokens) > 0, (
            f"{path.name}:{sentence.id} has zero expected tokens"
        )


def test_odia_lemma_accuracy_meets_floor():
    pipeline = OdiaPipeline(tokenizer=str.split, lemmas=default_lemma_table())
    result = evaluate(pipeline, load_corpus(_ODIA_CORPUS))
    summary = result.summary()
    assert summary["lemma_accuracy"] >= ODIA_LEMMA_FLOOR, (
        f"Odia lemma accuracy regressed: {summary}\n"
        "First failures:\n" + "\n".join(result.failures[:20])
    )


def test_yiddish_lemma_accuracy_meets_floor():
    result = evaluate(build_yiddish_pipeline(), load_corpus(_YIDDISH_CORPUS))
    summary = result.summary()
    assert summary["lemma_accuracy"] >= YIDDISH_LEMMA_FLOOR, (
        f"Yiddish lemma accuracy regressed: {summary}\n"
        "First failures:\n" + "\n".join(result.failures[:20])
    )


def test_hindi_real_pipeline_meets_lemma_floor():
    lexicon = Lexicon([SEED, _GOLDEN_DIR / "hindi_dictionary.json"])
    ids = {key: key for key in lexicon.entries}

    class CorpusDictionary:
        def load(self):
            return lexicon, ids, 1

    pipeline = HindiDBPipeline(CorpusDictionary())
    missed = []
    words = 0
    for sentence in load_corpus(_HINDI_CORPUS).sentences:
        actual = pipeline.process(sentence.text).tokens
        assert [t.surface for t in actual] == [t.surface for t in sentence.tokens], sentence.id
        for expected, token in zip(sentence.tokens, actual, strict=True):
            if expected.lemma is None:
                assert not token.is_word and not token.candidates, (sentence.id, token.surface)
                continue
            words += 1
            assert token.is_word, (sentence.id, token.surface)
            # The reader shows every possible dictionary match for a word.
            matches = {(c.lemma, c.pos) for c in token.candidates}
            if (expected.lemma, expected.pos) not in matches:
                missed.append(f"{sentence.id}: {token.surface} ({expected.lemma}, {expected.pos})")
    assert words > 0
    accuracy = (words - len(missed)) / words
    assert accuracy >= HINDI_LEMMA_FLOOR, f"Hindi lemma accuracy {accuracy:.2%}. Missing: {missed}"
