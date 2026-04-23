from __future__ import annotations

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str
    languages: list[str]


class ProcessRequest(BaseModel):
    language: str = Field(..., description="ISO 639-1 language code (e.g. 'hi', 'mr', 'or').")
    text: str = Field(..., min_length=1)


class LemmaCandidate(BaseModel):
    lemma: str
    pos: str
    score: float
    features: dict[str, str] = Field(default_factory=dict)


class Token(BaseModel):
    idx: int
    surface: str
    is_word: bool
    candidates: list[LemmaCandidate] = Field(default_factory=list)
    is_ambiguous: bool = False
    is_oov: bool = False
    romanization: str | None = None


class ProcessResponse(BaseModel):
    language: str
    pipeline_id: str
    tokens: list[Token]
