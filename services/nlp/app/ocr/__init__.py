"""OCR support for the PDF image reader.

The browser rasterizes each PDF page client-side and uploads the image;
this package turns one page image into the same token shape the rest of
the pipeline already speaks, plus a per-token bounding box so clicks on
the image map to words.

Two sources of "where is each character on the page":

  - :mod:`app.ocr.vision` — Google Cloud Vision OCR for scanned pages.
  - :mod:`app.ocr.borndigital` — boxes the client extracted from a PDF's
    embedded text layer (no Vision call, ≈free/100%).

Both produce an :class:`~app.ocr.align.OcrPage` (page text + per-char
boxes); :func:`app.ocr.align.assign_token_boxes` then maps the language
pipeline's tokens onto those boxes.
"""

from __future__ import annotations
