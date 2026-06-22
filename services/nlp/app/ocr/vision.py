"""Google Cloud Vision OCR for scanned PDF pages.

`google-cloud-vision` is an ``[ocr]``-extra dependency (not installed in
the default test/CI lane), so it is imported lazily inside
:func:`detect_document_text` — exactly like the Stanza pipelines. Tests
either build an :class:`~app.ocr.align.OcrPage` from a fake annotation via
:func:`build_ocr_page` or monkeypatch :func:`run_vision_ocr`, so they
never trigger the import.

Vision returns a character hierarchy (page → block → paragraph → word →
symbol) with per-symbol bounding polygons and per-symbol "detected break"
hints. :func:`build_ocr_page` flattens that into page text + one box per
character, normalizing pixel coords by the page dimensions Vision reports.
"""

from __future__ import annotations

import unicodedata
from typing import Any

from app.schemas import BBox

from .align import OcrPage


class VisionError(RuntimeError):
    """Vision returned an API-level error for the page."""


# Vision's DetectedBreak.BreakType integer values → the character(s) to
# splice into the reconstructed text AFTER a word's final symbol. See
# google.cloud.vision.TextAnnotation.DetectedBreak.BreakType.
#   0 UNKNOWN, 1 SPACE, 2 SURE_SPACE, 3 EOL_SURE_SPACE, 4 LINE_BREAK,
#   5 HYPHEN.
#
# HYPHEN nominally means a word was split across a line with a hyphen, so
# joining (drop the hyphen, no separator) would be ideal. But in practice
# Vision emits HYPHEN at ordinary line/block ends too (observed across a
# scanned book: every line-final word — "Erraza", "trinkoak", "etzan" —
# came back HYPHEN). Mapping it to "" then glues unrelated words across
# lines ("Erraza" + "4.3.1." → "Erraza4.3.1.") and their bounding boxes
# merge into one tall box covering neighbours. Gluing is far more damaging
# than the rare cost of splitting a genuinely hyphenated word, so we treat
# HYPHEN as a line break too. UNKNOWN stays "" — it marks intra-word
# symbol boundaries (no separator) as well as the odd "4.3.1."+"." case.
_BREAK_TEXT: dict[int, str] = {
    1: " ",
    2: " ",
    3: "\n",
    4: "\n",
    5: "\n",
}


_CLIENT: Any = None


def _client(vision_mod: Any) -> Any:
    global _CLIENT
    if _CLIENT is None:
        _CLIENT = vision_mod.ImageAnnotatorClient()
    return _CLIENT


def detect_document_text(image_bytes: bytes) -> Any:
    """Run Vision document text detection; return its
    ``full_text_annotation``. Raises :class:`VisionError` on API error."""
    from google.cloud import vision  # lazy: [ocr] extra

    client = _client(vision)
    image = vision.Image(content=image_bytes)
    resp = client.document_text_detection(image=image)
    if getattr(resp, "error", None) and resp.error.message:
        raise VisionError(resp.error.message)
    return resp.full_text_annotation


def _break_type(symbol: Any) -> int:
    prop = getattr(symbol, "property", None)
    brk = getattr(prop, "detected_break", None) if prop is not None else None
    if brk is None:
        return 0
    # proto-plus exposes the enum as ``type_``; older clients as ``type``.
    raw = getattr(brk, "type_", getattr(brk, "type", 0))
    try:
        return int(raw)
    except (TypeError, ValueError):
        return 0


def _norm_box(bounding_box: Any, page_w: int, page_h: int) -> BBox:
    xs = [float(v.x) for v in bounding_box.vertices]
    ys = [float(v.y) for v in bounding_box.vertices]
    pw = float(page_w) or 1.0
    ph = float(page_h) or 1.0
    x0, x1 = min(xs), max(xs)
    y0, y1 = min(ys), max(ys)
    return BBox(x=x0 / pw, y=y0 / ph, w=(x1 - x0) / pw, h=(y1 - y0) / ph)


def build_ocr_page(annotation: Any) -> OcrPage:
    """Flatten a Vision ``full_text_annotation`` into an OcrPage."""
    chars: list[str] = []
    boxes: list[BBox | None] = []
    for page in getattr(annotation, "pages", []) or []:
        pw = getattr(page, "width", 0)
        ph = getattr(page, "height", 0)
        for block in getattr(page, "blocks", []) or []:
            for para in getattr(block, "paragraphs", []) or []:
                for word in getattr(para, "words", []) or []:
                    for symbol in getattr(word, "symbols", []) or []:
                        box = _norm_box(symbol.bounding_box, pw, ph)
                        # NFC per-symbol so normalization can't desync the
                        # per-char box list (see borndigital builder).
                        text = unicodedata.normalize("NFC", symbol.text)
                        for ch in text:
                            chars.append(ch)
                            boxes.append(box)
                        sep = _BREAK_TEXT.get(_break_type(symbol), "")
                        for ch in sep:
                            chars.append(ch)
                            boxes.append(None)
    return OcrPage(text="".join(chars), char_boxes=boxes)


def run_vision_ocr(image_bytes: bytes) -> OcrPage:
    return build_ocr_page(detect_document_text(image_bytes))


__all__ = [
    "VisionError",
    "build_ocr_page",
    "detect_document_text",
    "run_vision_ocr",
]
