"""NLP service entry.

M0 scope: health check + a canned /process response that proves the web
service can reach this service through Docker networking and that types
round-trip. Real pipelines land in M2 (T-2.2 / T-2.3 / T-2.3a).
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException

from app.languages import LANGUAGES, SUPPORTED_LANGUAGE_CODES, is_supported_language
from app.schemas import (
    HealthResponse,
    LemmaCandidate,
    ProcessRequest,
    ProcessResponse,
    Token,
)

app = FastAPI(title="CIA Reader NLP", version="0.0.0")


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        languages=list(SUPPORTED_LANGUAGE_CODES),
    )


@app.post("/process", response_model=ProcessResponse)
async def process(req: ProcessRequest) -> ProcessResponse:
    if not is_supported_language(req.language):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported language '{req.language}'. Supported: {list(SUPPORTED_LANGUAGE_CODES)}",
        )

    descriptor = LANGUAGES[req.language]  # type: ignore[index]

    # Canned tokenization: split on whitespace, each word becomes a token with
    # a single low-confidence candidate = the surface form. Real tokenization
    # + lemmatization comes in M2.
    raw_tokens = req.text.split()
    tokens: list[Token] = []
    for idx, surface in enumerate(raw_tokens):
        tokens.append(
            Token(
                idx=idx,
                surface=surface,
                is_word=True,
                candidates=[
                    LemmaCandidate(lemma=surface, pos="X", score=1.0, features={}),
                ],
                is_ambiguous=False,
                is_oov=True,
                romanization=None,
            )
        )

    return ProcessResponse(
        language=req.language,
        pipeline_id=descriptor.pipeline_id,
        tokens=tokens,
    )
