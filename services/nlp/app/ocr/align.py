"""Token ↔ bounding-box alignment.

An :class:`OcrPage` carries the reconstructed page text plus one box per
character (``None`` for whitespace / line breaks that have no glyph). The
language pipeline tokenizes ``page.text``; :func:`assign_token_boxes`
walks the token list and, for each word token, unions the boxes of the
characters it spans.

Sourcing the boxes per-character (rather than per-Vision-word or
per-PDF-run) means the alignment is identical regardless of where the
boxes came from — Vision symbols or the client's born-digital layer — and
it survives our tokenizer segmenting words differently from the OCR
engine.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.schemas import BBox, Token


@dataclass(slots=True)
class OcrPage:
    """Page text + a box for every character in it (``char_boxes`` has the
    same length as ``text``; entries are ``None`` for separators)."""

    text: str
    char_boxes: list[BBox | None]


def union_boxes(boxes: list[BBox | None]) -> BBox | None:
    """Smallest box covering every non-``None`` box in ``boxes``.

    Returns ``None`` when there's nothing to cover (e.g. a token made
    entirely of separator characters). Components are rounded to 6
    decimals — sub-pixel on a normalized 0..1 page — so the JSON stays
    clean (no ``0.30000000000000004``) and the float subtraction below
    is deterministic."""
    present = [b for b in boxes if b is not None]
    if not present:
        return None
    x0 = min(b.x for b in present)
    y0 = min(b.y for b in present)
    x1 = max(b.x + b.w for b in present)
    y1 = max(b.y + b.h for b in present)
    return BBox(
        x=round(x0, 6),
        y=round(y0, 6),
        w=round(max(0.0, x1 - x0), 6),
        h=round(max(0.0, y1 - y0), 6),
    )


def assign_token_boxes(tokens: list[Token], page: OcrPage) -> list[BBox | None]:
    """Return one box per token, aligned to ``tokens`` by index.

    Word tokens are located by a forward scan through ``page.text`` (each
    surface picked up where the previous one left off, so repeated words
    map to their own occurrence). Non-word tokens, empty surfaces, and
    surfaces that can't be found get ``None``."""
    out: list[BBox | None] = []
    cursor = 0
    text = page.text
    for t in tokens:
        if not t.is_word or not t.surface:
            out.append(None)
            continue
        pos = text.find(t.surface, cursor)
        if pos < 0:
            # Normalization drift between the OCR text and the tokenizer's
            # surface (rare). Retry from the start before giving up so a
            # single mismatch doesn't desync the rest of the page.
            pos = text.find(t.surface)
        if pos < 0:
            out.append(None)
            continue
        end = pos + len(t.surface)
        out.append(union_boxes(page.char_boxes[pos:end]))
        cursor = end
    return out


__all__ = ["OcrPage", "assign_token_boxes", "union_boxes"]
