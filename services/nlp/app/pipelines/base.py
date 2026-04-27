"""Pipeline abstract base.

Every per-language pipeline produces a :class:`PipelineResult` — the list
of tokens plus the ``pipeline_id`` that the API response echoes back so
clients can tell which implementation produced the parse. The shape of a
Token matches :mod:`app.schemas`.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

from app.schemas import Token


@dataclass(frozen=True, slots=True)
class PipelineResult:
    pipeline_id: str
    tokens: list[Token]


class Pipeline(ABC):
    """Contract every language pipeline must satisfy."""

    #: Identifier surfaced to clients. Must match the shared language
    #: registry's ``pipelineId`` field for at least one language code.
    pipeline_id: str

    @abstractmethod
    def process(self, text: str) -> PipelineResult:
        """Tokenize + lemmatize + feature-annotate ``text``."""


__all__ = ["Pipeline", "PipelineResult"]
