"""NLP service entry.

Routes the /process HTTP request to the per-language pipeline registered
in :mod:`app.pipelines`. The HTTP layer's job is narrow: validate the
language, NFC-normalize input, dispatch, and echo the pipeline_id back to
the client. Real tokenization / lemmatization lives in the pipeline
modules so each language can evolve independently.
"""

from __future__ import annotations

import unicodedata

from fastapi import FastAPI, HTTPException

from app.languages import LANGUAGES, SUPPORTED_LANGUAGE_CODES, is_supported_language
from app.pipelines import get_pipeline
from app.schemas import HealthResponse, ProcessRequest, ProcessResponse

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
        supported = list(SUPPORTED_LANGUAGE_CODES)
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported language '{req.language}'. Supported: {supported}",
        )

    # NFC is the canonical form for every Indic script we support; many
    # Devanagari / Odia inputs arrive in other normalizations from the
    # wild web. Doing it once here means pipelines can assume NFC.
    text = unicodedata.normalize("NFC", req.text)
    pipeline = get_pipeline(req.language)
    result = pipeline.process(text)

    # The client always sees the language's canonical pipeline_id (from
    # the shared registry), not the pipeline instance's internal id — so
    # swapping in a stub during local dev still looks like the real
    # pipeline to the caller.
    canonical_pipeline_id = LANGUAGES[req.language].pipeline_id
    return ProcessResponse(
        language=req.language,
        pipeline_id=canonical_pipeline_id,
        tokens=result.tokens,
    )
