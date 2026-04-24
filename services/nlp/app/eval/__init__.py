"""Per-language pipeline evaluation harness.

Used by T-2.3b (Odia golden-file corpus) and by T-2.8 when CI accuracy
thresholds are enforced. The harness is deliberately language-agnostic:
it operates on a :class:`GoldenCorpus` + any :class:`Pipeline`, so the
same code path grades Hindi (T-2.2), Marathi (T-2.3), and Odia (T-2.3a).
"""

from __future__ import annotations

from .corpus import EvalResult, GoldenCorpus, GoldenSentence, GoldenToken, evaluate

__all__ = [
    "EvalResult",
    "GoldenCorpus",
    "GoldenSentence",
    "GoldenToken",
    "evaluate",
]
