"""Golden-file corpus loader + pipeline evaluator.

The corpus format is the one documented in the JSON fixtures (see
``app/pipelines/odia/data/golden_corpus.json``). Each entry asserts
only what the contributor is confident about — missing keys are
"don't-care" slots, so a sentence can pin the lemma without pinning
every morphology feature.

Accuracy is reported as a set of per-field rates (lemma, pos, feats,
is_oov, is_ambiguous) plus an overall "lemma + pos" joint rate, which
is the one T-2.8 thresholds in CI against. Per-sentence token counts
need not match — a divergence is a failure with a descriptive reason
so a human can spot what drifted.
"""

from __future__ import annotations

import json
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.pipelines.base import Pipeline


@dataclass(frozen=True, slots=True)
class GoldenToken:
    """Expected analysis for a single token. Missing fields are not checked."""

    surface: str
    lemma: str | None = None
    pos: str | None = None
    features: dict[str, str] | None = None
    is_oov: bool | None = None
    is_ambiguous: bool | None = None


@dataclass(frozen=True, slots=True)
class GoldenSentence:
    id: str
    text: str
    tokens: tuple[GoldenToken, ...]
    source: str | None = None
    comment: str | None = None


@dataclass(frozen=True, slots=True)
class GoldenCorpus:
    sentences: tuple[GoldenSentence, ...]

    def __len__(self) -> int:
        return len(self.sentences)


def load_corpus(path: Path) -> GoldenCorpus:
    raw: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    sentences: list[GoldenSentence] = []
    for entry in raw.get("sentences", []):
        tokens = tuple(
            GoldenToken(
                surface=unicodedata.normalize("NFC", t["surface"]),
                lemma=_nfc_or_none(t.get("lemma")),
                pos=t.get("pos"),
                features=t.get("features"),
                is_oov=t.get("is_oov"),
                is_ambiguous=t.get("is_ambiguous"),
            )
            for t in entry["tokens"]
        )
        sentences.append(
            GoldenSentence(
                id=entry["id"],
                text=unicodedata.normalize("NFC", entry["text"]),
                tokens=tokens,
                source=entry.get("source"),
                comment=entry.get("comment"),
            )
        )
    return GoldenCorpus(sentences=tuple(sentences))


def _nfc_or_none(value: str | None) -> str | None:
    return unicodedata.normalize("NFC", value) if value else None


@dataclass
class _Counter:
    correct: int = 0
    total: int = 0

    def add(self, ok: bool) -> None:
        self.total += 1
        if ok:
            self.correct += 1

    @property
    def rate(self) -> float:
        return self.correct / self.total if self.total else 1.0


@dataclass
class EvalResult:
    """Aggregated per-field accuracy + a list of human-readable failures.

    ``failures`` is capped at ~50 entries by the caller if needed; the
    list is intentionally verbose so a CI failure points the reviewer
    at a specific golden sentence rather than just "accuracy dropped."
    """

    sentence_count: int = 0
    token_count: int = 0
    lemma: _Counter = field(default_factory=_Counter)
    pos: _Counter = field(default_factory=_Counter)
    features: _Counter = field(default_factory=_Counter)
    is_oov: _Counter = field(default_factory=_Counter)
    is_ambiguous: _Counter = field(default_factory=_Counter)
    joint_lemma_pos: _Counter = field(default_factory=_Counter)
    failures: list[str] = field(default_factory=list)

    def summary(self) -> dict[str, float]:
        return {
            "lemma_accuracy": self.lemma.rate,
            "pos_accuracy": self.pos.rate,
            "features_accuracy": self.features.rate,
            "is_oov_accuracy": self.is_oov.rate,
            "is_ambiguous_accuracy": self.is_ambiguous.rate,
            "joint_lemma_pos_accuracy": self.joint_lemma_pos.rate,
        }


def evaluate(pipeline: Pipeline, corpus: GoldenCorpus) -> EvalResult:
    result = EvalResult()

    for sentence in corpus.sentences:
        result.sentence_count += 1
        pipeline_result = pipeline.process(sentence.text)
        actual_tokens = pipeline_result.tokens

        if len(actual_tokens) != len(sentence.tokens):
            result.failures.append(
                f"[{sentence.id}] token count mismatch — "
                f"expected {len(sentence.tokens)}, got {len(actual_tokens)}"
            )
            # Token count mismatch: skip per-token scoring but still count
            # the sentence so a systematic tokenizer regression trips this.
            continue

        for expected, actual in zip(sentence.tokens, actual_tokens, strict=True):
            result.token_count += 1
            top = actual.candidates[0] if actual.candidates else None

            lemma_ok = _check(
                expected.lemma,
                top.lemma if top else None,
                result.lemma,
                sentence.id,
                expected.surface,
                "lemma",
                result.failures,
            )
            pos_ok = _check(
                expected.pos,
                top.pos if top else None,
                result.pos,
                sentence.id,
                expected.surface,
                "pos",
                result.failures,
            )
            if expected.lemma is not None and expected.pos is not None:
                result.joint_lemma_pos.add(lemma_ok and pos_ok)

            if expected.features is not None:
                got = top.features if top else {}
                ok = all(got.get(k) == v for k, v in expected.features.items())
                result.features.add(ok)
                if not ok:
                    result.failures.append(
                        f"[{sentence.id}:{expected.surface}] features "
                        f"expected subset {expected.features}, got {got}"
                    )

            _check(
                expected.is_oov,
                actual.is_oov,
                result.is_oov,
                sentence.id,
                expected.surface,
                "is_oov",
                result.failures,
            )
            _check(
                expected.is_ambiguous,
                actual.is_ambiguous,
                result.is_ambiguous,
                sentence.id,
                expected.surface,
                "is_ambiguous",
                result.failures,
            )

    return result


def _check(
    expected: Any,
    actual: Any,
    counter: _Counter,
    sentence_id: str,
    surface: str,
    field_name: str,
    failures: list[str],
) -> bool:
    if expected is None:
        return True
    ok = expected == actual
    counter.add(ok)
    if not ok:
        failures.append(
            f"[{sentence_id}:{surface}] {field_name} expected {expected!r}, got {actual!r}"
        )
    return ok
