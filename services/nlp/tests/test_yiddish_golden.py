"""Yiddish golden-file corpus tests.

The corpus at ``app/pipelines/yiddish/data/golden_corpus.json`` pairs
Yiddish sentences with expected per-token analyses, mirroring the Odia
suite. The corpus is hand-written against the seed lemma table so we
expect near-perfect scores; a drop means the seed, the morph rules, or
the tokenizer regressed. Unlike Odia there's no tokenizer fake — the
production regex tokenizer runs in CI as-is.
"""

from __future__ import annotations

from pathlib import Path

from app.eval import GoldenCorpus, evaluate
from app.eval.corpus import load_corpus
from app.pipelines.yiddish import YiddishPipeline, build_yiddish_pipeline

_CORPUS_PATH = (
    Path(__file__).resolve().parent.parent
    / "app"
    / "pipelines"
    / "yiddish"
    / "data"
    / "golden_corpus.json"
)


def _load() -> GoldenCorpus:
    return load_corpus(_CORPUS_PATH)


def _pipeline() -> YiddishPipeline:
    return build_yiddish_pipeline()


def test_corpus_loads_and_is_non_empty():
    corpus = _load()
    assert len(corpus) >= 15, "corpus shrank — did a data PR accidentally drop entries?"
    # Spot-check the smoke-test sentence is still in here.
    assert any(s.text == "איך שרייַב אַ בוך" for s in corpus.sentences)


def test_corpus_entries_have_unique_ids():
    corpus = _load()
    ids = [s.id for s in corpus.sentences]
    assert len(ids) == len(set(ids)), "duplicate golden sentence ids — merge them"


def test_yiddish_pipeline_meets_joint_lemma_pos_floor():
    # Hand-written corpus + hand-written rules → this should be
    # basically perfect; the corpus-wide ≥70% release floor lives in
    # test_accuracy_thresholds.py alongside the other languages.
    result = evaluate(_pipeline(), _load())
    summary = result.summary()
    assert (
        summary["joint_lemma_pos_accuracy"] >= 0.95
    ), f"joint lemma+POS accuracy regressed: {summary}\nfailures:\n" + "\n".join(
        result.failures[:20]
    )


def test_yiddish_pipeline_feature_accuracy_is_high():
    result = evaluate(_pipeline(), _load())
    summary = result.summary()
    assert (
        summary["features_accuracy"] >= 0.80
    ), f"feature accuracy regressed: {summary}\nfailures:\n" + "\n".join(
        result.failures[:20]
    )


def test_oov_detection_is_accurate():
    result = evaluate(_pipeline(), _load())
    summary = result.summary()
    assert (
        summary["is_oov_accuracy"] >= 0.95
    ), f"OOV detection regressed: {summary}\nfailures:\n" + "\n".join(
        result.failures[:20]
    )


def test_token_counts_match_for_every_sentence():
    # A tokenizer change that splits or joins differently from the
    # corpus would silently tank all per-token scores. Guard the
    # invariant explicitly so the message is actionable.
    result = evaluate(_pipeline(), _load())
    count_failures = [f for f in result.failures if "token count mismatch" in f]
    assert count_failures == [], "tokenization drift:\n" + "\n".join(count_failures)
