"""Score a language pipeline against the expected words and analyses in its test corpus."""

from __future__ import annotations

from .corpus import EvalResult, GoldenCorpus, GoldenSentence, GoldenToken, evaluate

__all__ = [
    "EvalResult",
    "GoldenCorpus",
    "GoldenSentence",
    "GoldenToken",
    "evaluate",
]
