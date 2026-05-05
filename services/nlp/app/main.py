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
from app.phrases import get_detector
from app.pipelines import get_pipeline
from app.schemas import HealthResponse, ProcessRequest, ProcessResponse

app = FastAPI(title="CIA Reader NLP", version="0.0.0")


async def _health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        languages=list(SUPPORTED_LANGUAGE_CODES),
    )


# /health is the legacy name; /healthz is the canonical one aligned
# with the rest of the stack (T-13.5 monitoring). Both are backed by
# the same handler so existing callers (the dev compose's Dockerfile
# healthcheck) keep working unchanged.
app.add_api_route("/health", _health, response_model=HealthResponse, methods=["GET"])
app.add_api_route("/healthz", _health, response_model=HealthResponse, methods=["GET"])


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

    # T-14.5: rule-based phrase detector runs over the Stanza output.
    # The detector is per-language and lazy-loaded; an empty pattern
    # set produces an empty proposal list (a brand-new language can
    # ship without phrase support and still serve a well-formed
    # response). The web worker (T-14.5a) writes proposals to
    # `phrase_proposals` and a periodic promotion pass moves
    # ≥3-chapter occurrences into `phrases` (`source='nlp'`).
    detector = get_detector(req.language)
    proposed_phrases = detector.detect(result.tokens)

    # The client always sees the language's canonical pipeline_id (from
    # the shared registry), not the pipeline instance's internal id — so
    # swapping in a stub during local dev still looks like the real
    # pipeline to the caller.
    canonical_pipeline_id = LANGUAGES[req.language].pipeline_id
    return ProcessResponse(
        language=req.language,
        pipeline_id=canonical_pipeline_id,
        tokens=result.tokens,
        proposed_phrases=proposed_phrases,
    )
