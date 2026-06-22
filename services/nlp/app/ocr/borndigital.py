"""Born-digital page builder.

For PDFs with a real embedded text layer (generated from a digital
source, not a scan), the client extracts the text runs + their positions
via pdf.js and uploads them instead of paying for OCR. Each run is one
``{str, x, y, w, h, eol}`` item with box coords already normalized to
0..1 of the rendered page and top-left origin.

We turn the run list into the same per-character :class:`OcrPage` the
Vision path produces: a run's box is split proportionally across its
characters (pdf.js gives run-level boxes, coarser than Vision's
per-symbol boxes), and runs are joined with a newline (``eol``) or a
space so the language tokenizer sees sensible word boundaries.
"""

from __future__ import annotations

import unicodedata
from collections.abc import Sequence
from typing import Any

from app.schemas import BBox

from .align import OcrPage


def build_born_digital_page(items: Sequence[dict[str, Any]]) -> OcrPage:
    chars: list[str] = []
    boxes: list[BBox | None] = []
    n_items = len(items)
    for i, item in enumerate(items):
        # NFC per-run (not over the whole page) so normalization can't
        # reorder/merge across the box boundary and desync char_boxes.
        s = unicodedata.normalize("NFC", str(item.get("str", "")))
        n = len(s)
        if n:
            x = float(item.get("x", 0.0))
            y = float(item.get("y", 0.0))
            w = float(item.get("w", 0.0))
            h = float(item.get("h", 0.0))
            per = w / n if n else w
            for j, ch in enumerate(s):
                chars.append(ch)
                boxes.append(BBox(x=x + per * j, y=y, w=per, h=h))
        # Separator between runs (not after the last). pdf.js flags the
        # end of a visual line with `eol`.
        if i < n_items - 1:
            sep = "\n" if item.get("eol") else " "
            for ch in sep:
                chars.append(ch)
                boxes.append(None)
    return OcrPage(text="".join(chars), char_boxes=boxes)


__all__ = ["build_born_digital_page"]
