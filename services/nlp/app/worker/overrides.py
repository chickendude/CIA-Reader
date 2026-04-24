"""Crowdsourced override lookup for the NLP worker (T-2.7).

When enough users independently correct the same ``(language, surface,
context)`` tuple (T-6.7 aggregation), the winner is promoted into the
``form_lemma_overrides`` table. From that point on, every freshly
processed chapter that hits the same surface in the same context
should get the curated lemma — not whatever Stanza's latest top-1
happens to be. That's the loop that lets the system self-heal
without anyone re-training a model.

This module owns two pieces:

* :func:`context_signature` — the deterministic, short, indexable hash
  of a token's positional context. Stored both on the override row
  (T-6.7 writes it) and computed here at lookup time (T-2.7 reads it).
  If the two sides ever disagree, overrides silently stop applying —
  so the formula is kept trivially simple and the test suite pins it.
* :class:`OverrideStore` + :func:`apply_overrides` — the protocol the
  worker consults per chapter, and the pure function that swaps in
  any hits. Kept as a Protocol for the same reason the rest of the
  worker stores are: unit tests wire an in-memory fake, M4 wires the
  real Postgres-backed implementation.

Deliberately out of scope for this ticket: writing overrides. That's
T-6.7's aggregation worker. Here we only read.
"""

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
    """Rewrite any tokens whose ``(surface, context)`` has a promoted override.

    The override wins over whatever Stanza (or the Odia rule-based
    pipeline) produced: it becomes the new top candidate, ``is_oov``
    flips to false (we have a curated lemma now), and ``is_ambiguous``
    flips to false (the crowd has already picked a side). The original
    candidates are preserved below the override so the "alternate
    meanings" UI (T-6.1) can still surface them.

    Non-word tokens (punctuation, whitespace) are skipped — the
    override system is for lexical items only.

    Passing ``store=None`` is a no-op and returns the input unchanged.
    That's the default state in the MVP before the aggregation worker
    (T-6.7) has promoted anything, and it's also what unit tests that
    don't care about overrides use.
    """
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
