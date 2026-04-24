"""Odia golden-file corpus tests (T-2.3b).

The corpus at ``app/pipelines/odia/data/golden_corpus.json`` pairs Odia
sentences with expected per-token analyses. This suite runs the custom
Odia pipeline over the corpus and enforces a minimum joint
lemma+POS accuracy.

The threshold here is deliberately a sanity floor — T-2.8 raises it
(≥70% for Odia per the plan) and wires it into CI. Right now the
corpus is hand-written against the seed lemma table so we expect near-
perfect scores; a drop means either the seed, the morph rules, or the
tokenizer regressed. The eval harness is language-agnostic so Hindi /
Marathi corpora can slot in later without a rewrite.
"""

from __future__ import annotations

from pathlib import Path

from app.eval import GoldenCorpus, evaluate
from app.eval.corpus import load_corpus
from app.pipelines.odia import OdiaPipeline
from app.pipelines.odia.lemmas import default_lemma_table

_CORPUS_PATH = (
    Path(__file__).resolve().parent.parent
    / "app"
    / "pipelines"
    / "odia"
    / "data"
    / "golden_corpus.json"
)


def _split(text: str) -> list[str]:
    return text.split()


def _load() -> GoldenCorpus:
    return load_corpus(_CORPUS_PATH)


def _pipeline() -> OdiaPipeline:
    return OdiaPipeline(tokenizer=_split, lemmas=default_lemma_table())


def test_corpus_loads_and_is_non_empty():
    corpus = _load()
    assert len(corpus) >= 15, "corpus shrank — did a data PR accidentally drop entries?"
    # Spot-check the smoke-test sentence is still in here.
    assert any(s.text == "ନମସ୍କାର ଦୁନିଆ" for s in corpus.sentences)


def test_corpus_entries_have_unique_ids():
    corpus = _load()
    ids = [s.id for s in corpus.sentences]
    assert len(ids) == len(set(ids)), "duplicate golden sentence ids — merge them"


def test_odia_pipeline_meets_joint_lemma_pos_floor():
    # Hand-written corpus + hand-written rules → this should be basically
    # perfect. T-2.8 will swap this for the ≥70% real-world accuracy
    # threshold when the corpus grows to include harder sentences.
    result = evaluate(_pipeline(), _load())
    summary = result.summary()
    assert (
        summary["joint_lemma_pos_accuracy"] >= 0.95
    ), f"joint lemma+POS accuracy regressed: {summary}\nfailures:\n" + "\n".join(
        result.failures[:20]
    )


def test_odia_pipeline_feature_accuracy_is_high():
    result = evaluate(_pipeline(), _load())
    summary = result.summary()
    # Feature subset matching — set loose enough to tolerate future
    # corpus entries that test hard features we haven't modeled yet.
    assert (
        summary["features_accuracy"] >= 0.80
    ), f"feature accuracy regressed: {summary}\nfailures:\n" + "\n".join(
        result.failures[:20]
    )


def test_oov_detection_is_accurate():
    # The OOV expectations in the corpus must be met — if they drift
    # the reader will silently flip between "unknown word" and "word"
    # states for the same input.
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
