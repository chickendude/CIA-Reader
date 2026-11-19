"""Check word analyses against a reference corpus. The real_models tests run separately because
they load language models."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.eval import evaluate
from app.eval.corpus import load_corpus
from app.pipelines import get_pipeline, reset_pipeline_cache
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
MARATHI_LEMMA_FLOOR = 0.80
ODIA_LEMMA_FLOOR = 0.70
# Yiddish ships the same custom-pipeline tier as Odia: rule-based
# morphology over a seed table, with the unpointed loshn-koydesh
# vocabulary as the known weak spot.
YIDDISH_LEMMA_FLOOR = 0.70
# Basque is Stanza-backed (UD_Basque-BDT), a well-resourced UD model, so
# it lands in the Hindi tier. The floor sits below the observed ~1.0 on
# the golden corpus to leave headroom for model-version drift.
EUSKARA_LEMMA_FLOOR = 0.85


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


# ---- Odia accuracy floor (runs in default suite — no Stanza needed) ----


def test_odia_lemma_accuracy_meets_floor():
    # Odia uses the hand-rolled pipeline (IndicNLP tokenizer + rule-based
    # morph + seed lemma table) so no heavyweight model download is
    # required; the whitespace-split tokenizer works because the golden
    # sentences are space-delimited by construction. That's what makes
    # the ≥70% floor enforceable in the default CI lane — unlike Hi/Mr.
    pipeline = OdiaPipeline(tokenizer=str.split, lemmas=default_lemma_table())
    result = evaluate(pipeline, load_corpus(_ODIA_CORPUS))
    summary = result.summary()
    assert summary["lemma_accuracy"] >= ODIA_LEMMA_FLOOR, (
        f"Odia lemma accuracy regressed: {summary}\n"
        "First failures:\n" + "\n".join(result.failures[:20])
    )


def test_yiddish_lemma_accuracy_meets_floor():
    # Yiddish is fully dependency-free (regex tokenizer + rule-based
    # morph + seed lemma table), so the production factory itself runs
    # in the default lane — no model download, no tokenizer fake.
    result = evaluate(build_yiddish_pipeline(), load_corpus(_YIDDISH_CORPUS))
    summary = result.summary()
    assert summary["lemma_accuracy"] >= YIDDISH_LEMMA_FLOOR, (
        f"Yiddish lemma accuracy regressed: {summary}\n"
        "First failures:\n" + "\n".join(result.failures[:20])
    )


# ---- real-model accuracy (skipped unless -m real_models) ----


@pytest.fixture
def _clean_pipeline_cache():
    # The conftest autouse fixture swaps the real factories with fakes;
    # real-model tests re-import the real factories and reset the cache
    # so ``get_pipeline`` actually goes to Stanza. The fixture also
    # restores state afterwards so later tests in the same worker don't
    # see a contaminated cache.
    from app import pipelines
    from app.pipelines.basque import build_basque_pipeline
    from app.pipelines.marathi import build_marathi_pipeline
    from app.pipelines.odia import build_odia_pipeline

    saved = dict(pipelines._PIPELINE_FACTORIES)
    pipelines._PIPELINE_FACTORIES["stanza-mr"] = build_marathi_pipeline
    pipelines._PIPELINE_FACTORIES["custom-or"] = build_odia_pipeline
    pipelines._PIPELINE_FACTORIES["stanza-eu"] = build_basque_pipeline
    reset_pipeline_cache()
    try:
        yield
    finally:
        pipelines._PIPELINE_FACTORIES.clear()
        pipelines._PIPELINE_FACTORIES.update(saved)
        reset_pipeline_cache()


@pytest.mark.real_models
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


@pytest.mark.real_models
def test_marathi_real_pipeline_meets_lemma_floor(_clean_pipeline_cache):
    pipeline = get_pipeline("mr")
    result = evaluate(pipeline, load_corpus(_MARATHI_CORPUS))
    summary = result.summary()
    assert summary["lemma_accuracy"] >= MARATHI_LEMMA_FLOOR, (
        f"Marathi lemma accuracy regressed: {summary}\n"
        "First failures:\n" + "\n".join(result.failures[:30])
    )


@pytest.mark.real_models
def test_basque_real_pipeline_meets_lemma_floor(_clean_pipeline_cache):
    # Basque needs the real Stanza UD_Basque-BDT model (like Hi/Mr), so it
    # only runs in the nlp-accuracy lane. The golden corpus is pinned to the
    # model's current analysis, so this guards against model-version drift.
    pipeline = get_pipeline("eu")
    result = evaluate(pipeline, load_corpus(_BASQUE_CORPUS))
    summary = result.summary()
    assert summary["lemma_accuracy"] >= EUSKARA_LEMMA_FLOOR, (
        f"Basque lemma accuracy regressed: {summary}\n"
        "First failures:\n" + "\n".join(result.failures[:30])
    )


@pytest.mark.real_models
def test_odia_real_pipeline_meets_lemma_floor(_clean_pipeline_cache):
    # Also runs Odia under the real pipeline (IndicNLP tokenizer, not
    # the whitespace fake) so the nlp-accuracy job catches any
    # IndicNLP-tokenization drift the default suite would miss.
    pipeline = get_pipeline("or")
    result = evaluate(pipeline, load_corpus(_ODIA_CORPUS))
    summary = result.summary()
    assert summary["lemma_accuracy"] >= ODIA_LEMMA_FLOOR, (
        f"Odia (real pipeline) lemma accuracy regressed: {summary}\n"
        "First failures:\n" + "\n".join(result.failures[:30])
    )
