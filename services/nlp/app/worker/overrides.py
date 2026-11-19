"""Look for a correction for this spelling and its surrounding parts of speech. A correction
without a context signature can apply to any occurrence of the spelling."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Protocol

from app.schemas import LemmaCandidate, Token

_SENTINEL_BOS = "BOS"
_SENTINEL_EOS = "EOS"
_SENTINEL_UNK = "X"


@dataclass(frozen=True, slots=True)
class OverrideHit:
    """A promoted override the worker must honor over Stanza's guess."""

    lemma: str
    pos: str
    features: dict[str, str]


class OverrideStore(Protocol):
    async def lookup(
        self,
        *,
        language: str,
        surface_nfc: str,
        context_signature: str,
    ) -> OverrideHit | None: ...


def context_signature(
    *,
    prev_pos: str | None,
    cur_pos: str | None,
    next_pos: str | None,
) -> str:
    """Return a short stable signature for a token's POS context.

    Uses previous / current / next POS tags — no lemmas, no surfaces.
    That's deliberate: the signature is meant to distinguish *uses*
    of a homograph (e.g. "will" as AUX vs. NOUN), not to re-identify
    the surface itself (which is already part of the override key).

    Sentinels (``BOS`` / ``EOS``) fill in at chapter boundaries so
    the signature is defined for the first and last tokens. Unknown /
    missing POS degrades to ``X`` rather than crashing — an override
    keyed against a well-known POS simply won't match, which is the
    safe direction to fail.

    The sha1-16 truncation keeps the signature short enough to index
    cheaply while leaving collision probability negligible at the
    scale we care about (~10^8 override rows is still ~10^-12).
    """
    raw = f"{prev_pos or _SENTINEL_UNK}|{cur_pos or _SENTINEL_UNK}|{next_pos or _SENTINEL_UNK}"
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()
    return digest[:16]


def _top_pos(token: Token) -> str | None:
    return token.candidates[0].pos if token.candidates else None


async def apply_overrides(
    *,
    tokens: list[Token],
    language: str,
    store: OverrideStore | None,
) -> list[Token]:
    """Put the matching correction first and keep the parser's other suggestions available to the
    reader. With no matching correction, keep the original choices."""
    if store is None or not tokens:
        return tokens

    pos_sequence: list[str | None] = [
        _top_pos(tok) if tok.is_word else None for tok in tokens
    ]

    out: list[Token] = []
    for i, tok in enumerate(tokens):
        if not tok.is_word:
            out.append(tok)
            continue

        prev_pos = _sentinel_prev(pos_sequence, i)
        next_pos = _sentinel_next(pos_sequence, i)
        cur_pos = pos_sequence[i]
        sig = context_signature(prev_pos=prev_pos, cur_pos=cur_pos, next_pos=next_pos)

        hit = await store.lookup(
            language=language,
            surface_nfc=tok.surface,
            context_signature=sig,
        )
        if hit is None:
            out.append(tok)
            continue

        promoted = LemmaCandidate(
            lemma=hit.lemma,
            pos=hit.pos,
            score=1.0,
            features=dict(hit.features),
        )
        out.append(
            tok.model_copy(
                update={
                    "candidates": [promoted, *tok.candidates],
                    "is_oov": False,
                    "is_ambiguous": False,
                }
            )
        )

    return out


def _sentinel_prev(pos_sequence: list[str | None], i: int) -> str:
    for j in range(i - 1, -1, -1):
        if pos_sequence[j] is not None:
            return pos_sequence[j] or _SENTINEL_UNK
    return _SENTINEL_BOS


def _sentinel_next(pos_sequence: list[str | None], i: int) -> str:
    for j in range(i + 1, len(pos_sequence)):
        if pos_sequence[j] is not None:
            return pos_sequence[j] or _SENTINEL_UNK
    return _SENTINEL_EOS


__all__ = [
    "OverrideHit",
    "OverrideStore",
    "apply_overrides",
    "context_signature",
]
