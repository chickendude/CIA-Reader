"""Unit tests for the language-agnostic :mod:`app.eval` harness (T-2.3b).

The Odia-specific corpus tests live in :mod:`test_odia_golden`; this
suite exercises the harness itself so a future Hindi / Marathi corpus
doesn't have to re-prove its plumbing.
"""

from __future__ import annotations

import json
from pathlib import Path

from app.eval import evaluate
from app.eval.corpus import (
    EvalResult,
    GoldenCorpus,
    GoldenSentence,
    GoldenToken,
    load_corpus,
)
from app.pipelines.base import Pipeline, PipelineResult
from app.schemas import LemmaCandidate, Token


class _ScriptedPipeline(Pipeline):
    """Returns a pre-canned token list per input text."""

    pipeline_id = "scripted"

    def __init__(self, scripts: dict[str, list[Token]]) -> None:
        self._scripts = scripts

    def process(self, text: str) -> PipelineResult:
        return PipelineResult(
            pipeline_id=self.pipeline_id,
            tokens=list(self._scripts.get(text, [])),
        )


def _tok(
    idx: int,
    surface: str,
    lemma: str,
    pos: str,
    features: dict[str, str] | None = None,
    is_oov: bool = False,
    is_ambiguous: bool = False,
) -> Token:
    return Token(
        idx=idx,
        surface=surface,
        is_word=pos not in {"PUNCT", "SYM"},
        candidates=[
            LemmaCandidate(lemma=lemma, pos=pos, score=1.0, features=features or {}),
        ],
        is_ambiguous=is_ambiguous,
        is_oov=is_oov,
        romanization=None,
    )


def _sentence(
    sid: str,
    text: str,
    *tokens: GoldenToken,
) -> GoldenSentence:
    return GoldenSentence(id=sid, text=text, tokens=tokens)


def test_all_expectations_met_yields_perfect_scores():
    corpus = GoldenCorpus(
        sentences=(
            _sentence(
                "a",
                "foo bar",
                GoldenToken(surface="foo", lemma="foo", pos="NOUN"),
                GoldenToken(surface="bar", lemma="bar", pos="VERB"),
            ),
        )
    )
    pipeline = _ScriptedPipeline(
        {
            "foo bar": [
                _tok(0, "foo", "foo", "NOUN"),
                _tok(1, "bar", "bar", "VERB"),
            ]
        }
    )
    result = evaluate(pipeline, corpus)
    assert result.failures == []
    summary = result.summary()
    assert summary["lemma_accuracy"] == 1.0
    assert summary["pos_accuracy"] == 1.0
    assert summary["joint_lemma_pos_accuracy"] == 1.0


def test_lemma_mismatch_counted_and_reported():
    corpus = GoldenCorpus(
        sentences=(
            _sentence(
                "a",
                "x",
                GoldenToken(surface="x", lemma="expected", pos="NOUN"),
            ),
        )
    )
    pipeline = _ScriptedPipeline({"x": [_tok(0, "x", "got", "NOUN")]})
    result = evaluate(pipeline, corpus)
    assert result.lemma.rate == 0.0
    assert result.pos.rate == 1.0
    assert result.joint_lemma_pos.rate == 0.0
    assert any("lemma expected 'expected'" in f for f in result.failures)


def test_missing_expected_field_is_not_checked():
    # GoldenToken with no `pos` set means POS is a don't-care — so the
    # pipeline can return anything without contributing to pos accuracy.
    corpus = GoldenCorpus(
        sentences=(_sentence("a", "x", GoldenToken(surface="x", lemma="x")),)
    )
    pipeline = _ScriptedPipeline({"x": [_tok(0, "x", "x", "WEIRD_POS")]})
    result = evaluate(pipeline, corpus)
    assert result.pos.total == 0
    # don't-care fields return 1.0 on an empty counter.
    assert result.pos.rate == 1.0


def test_features_is_a_subset_check_not_exact():
    # Expected {Case: Loc} must match even if the actual dict has extra
    # keys — the rule set is allowed to grow features without rewriting
    # every corpus entry.
    corpus = GoldenCorpus(
        sentences=(
            _sentence(
                "a",
                "x",
                GoldenToken(surface="x", lemma="x", features={"Case": "Loc"}),
            ),
        )
    )
    pipeline = _ScriptedPipeline(
        {"x": [_tok(0, "x", "x", "NOUN", features={"Case": "Loc", "Number": "Sing"})]}
    )
    result = evaluate(pipeline, corpus)
    assert result.features.rate == 1.0


def test_features_mismatch_recorded():
    corpus = GoldenCorpus(
        sentences=(
            _sentence(
                "a",
                "x",
                GoldenToken(surface="x", features={"Case": "Loc"}),
            ),
        )
    )
    pipeline = _ScriptedPipeline(
        {"x": [_tok(0, "x", "x", "NOUN", features={"Case": "Gen"})]}
    )
    result = evaluate(pipeline, corpus)
    assert result.features.rate == 0.0
    assert any("features expected subset" in f for f in result.failures)


def test_token_count_mismatch_reports_descriptive_failure():
    corpus = GoldenCorpus(
        sentences=(
            _sentence(
                "a",
                "x",
                GoldenToken(surface="x"),
                GoldenToken(surface="y"),
            ),
        )
    )
    pipeline = _ScriptedPipeline({"x": [_tok(0, "x", "x", "NOUN")]})
    result = evaluate(pipeline, corpus)
    assert any("token count mismatch" in f for f in result.failures)
    # Per-token counters should not have been polluted by the bad row.
    assert result.token_count == 0


def test_token_count_mismatch_charges_lemma_and_pos_counters():
    # Without this, a tokenizer regression (e.g. Stanza splitting "माझे"
    # into two pieces) leaves lemma/pos counters at 0/0 and the rate
    # silently defaults to 1.0 — a vacuous pass that hides the
    # regression behind a "perfect score." Charge mismatched sentences
    # as failures against every pinned field instead.
    corpus = GoldenCorpus(
        sentences=(
            _sentence(
                "a",
                "x",
                GoldenToken(surface="x", lemma="x", pos="NOUN"),
                GoldenToken(surface="y", lemma="y", pos="VERB"),
            ),
        )
    )
    pipeline = _ScriptedPipeline({"x": [_tok(0, "x", "x", "NOUN")]})
    result = evaluate(pipeline, corpus)
    summary = result.summary()
    assert summary["lemma_accuracy"] == 0.0
    assert summary["pos_accuracy"] == 0.0
    assert summary["joint_lemma_pos_accuracy"] == 0.0


def test_is_oov_expectation_enforced():
    corpus = GoldenCorpus(
        sentences=(
            _sentence("a", "x", GoldenToken(surface="x", is_oov=True)),
        )
    )
    ok_pipeline = _ScriptedPipeline({"x": [_tok(0, "x", "x", "X", is_oov=True)]})
    bad_pipeline = _ScriptedPipeline({"x": [_tok(0, "x", "x", "NOUN", is_oov=False)]})
    assert evaluate(ok_pipeline, corpus).is_oov.rate == 1.0
    assert evaluate(bad_pipeline, corpus).is_oov.rate == 0.0


def test_load_corpus_nfc_normalizes(tmp_path: Path):
    # Write a corpus file with an NFD-form entry and confirm it
    # materialises as NFC. Protects the invariant that the harness
    # compares apples to apples regardless of how contributors typed.
    import unicodedata

    nfc = "ଘରରେ"
    nfd = unicodedata.normalize("NFD", nfc)
    data = {
        "sentences": [
            {
                "id": "nfd-guard",
                "text": nfd,
                "tokens": [{"surface": nfd, "lemma": nfd}],
            }
        ]
    }
    path = tmp_path / "corpus.json"
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    corpus = load_corpus(path)
    assert corpus.sentences[0].text == nfc
    assert corpus.sentences[0].tokens[0].surface == nfc
    assert corpus.sentences[0].tokens[0].lemma == nfc


def test_eval_result_summary_handles_empty_counters():
    # Sanity: a corpus that enforces nothing still returns a summary
    # (all rates default to 1.0 rather than NaN-ing).
    result = EvalResult()
    summary = result.summary()
    assert all(0.0 <= v <= 1.0 for v in summary.values())
