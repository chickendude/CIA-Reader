"""Canned pipeline used until the real per-language pipelines land.

Tokenizes on whitespace and emits one top-K candidate per token whose
lemma is just the surface form. Flags every token as OOV so the reader
surfaces the correction UX (M6) during pre-NLP end-to-end testing.

Kept separate from :mod:`app.main` so that T-2.2 / T-2.3 / T-2.3a can
plug real Stanza / IndicNLP models in by swapping the registry entry in
:mod:`app.pipelines.__init__` — no changes to the HTTP layer.
"""

from __future__ import annotations

from app.schemas import LemmaCandidate, Token

from .base import Pipeline, PipelineResult


class StubPipeline(Pipeline):
    """Whitespace-split, surface-as-lemma, everything OOV."""

    pipeline_id = "stub"

    def process(self, text: str) -> PipelineResult:
        # NFC normalization is the caller's job (happens in /process before
        # dispatch). Here we just split; the pipeline is intentionally dumb.
        surfaces = text.split()
        tokens = [
            Token(
                idx=i,
                surface=surface,
                is_word=True,
                candidates=[
                    LemmaCandidate(lemma=surface, pos="X", score=1.0, features={}),
                ],
                is_ambiguous=False,
                is_oov=True,
                romanization=None,
            )
            for i, surface in enumerate(surfaces)
        ]
        return PipelineResult(pipeline_id=self.pipeline_id, tokens=tokens)


__all__ = ["StubPipeline"]
