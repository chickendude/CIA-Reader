"""Tests for /ocr ``mode='raw'`` (transcription workbench).

Raw mode skips the language registry and pipeline entirely — dictionary
scan pages mix scripts (English glosses beside Devanagari/Odia
headwords) and the workbench only needs OCR text + word boxes. Nothing
here requires the ``[ocr]`` extra: Vision is monkeypatched.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

import app.main as main_module
from app.main import app
from app.ocr.align import OcrPage
from app.ocr.raw import raw_tokenize
from app.schemas import BBox

client = TestClient(app)

DUMMY_IMAGE = ("page.jpg", b"\x00\x01\x02\x03", "image/jpeg")


def _fake_page() -> OcrPage:
    # "kamal कमल" — mixed Latin + Devanagari with one box per character.
    text = "kamal कमल"
    boxes: list[BBox | None] = []
    for i, ch in enumerate(text):
        if ch.isspace():
            boxes.append(None)
        else:
            boxes.append(BBox(x=0.1 + i * 0.05, y=0.2, w=0.04, h=0.03))
    return OcrPage(text=text, char_boxes=boxes)


def test_raw_tokenize_whitespace_and_wordness():
    tokens = raw_tokenize("The lotus, — कमल 12")
    assert [t.surface for t in tokens] == ["The", "lotus,", "—", "कमल", "12"]
    assert [t.is_word for t in tokens] == [True, True, False, True, True]
    assert [t.idx for t in tokens] == [0, 1, 2, 3, 4]
    assert all(t.candidates == [] for t in tokens)


def test_raw_tokenize_empty_page():
    assert raw_tokenize("") == []
    assert raw_tokenize("   \n  ") == []


def test_ocr_raw_mode_returns_boxed_words(monkeypatch):
    monkeypatch.setattr(main_module, "run_vision_ocr", lambda _bytes: _fake_page())
    resp = client.post(
        "/ocr",
        data={"mode": "raw", "width": "1700", "height": "2200"},
        files={"image": DUMMY_IMAGE},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["pipeline_id"] == "raw"
    assert body["language"] == "raw"
    assert body["body"] == "kamal कमल"
    assert body["proposed_phrases"] == []
    surfaces = [t["surface"] for t in body["tokens"]]
    assert surfaces == ["kamal", "कमल"]
    # Both words carry a box unioned from their character boxes.
    assert all(t["bbox"] is not None for t in body["tokens"])
    assert body["tokens"][0]["bbox"]["x"] < body["tokens"][1]["bbox"]["x"]


def test_ocr_raw_mode_ignores_unregistered_language(monkeypatch):
    monkeypatch.setattr(main_module, "run_vision_ocr", lambda _bytes: _fake_page())
    resp = client.post(
        "/ocr",
        data={"mode": "raw", "language": "en", "width": "100", "height": "100"},
        files={"image": DUMMY_IMAGE},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["language"] == "en"


def test_ocr_pipeline_mode_still_validates_language():
    resp = client.post(
        "/ocr",
        data={"language": "en", "width": "100", "height": "100"},
        files={"image": DUMMY_IMAGE},
    )
    assert resp.status_code == 400
    resp = client.post(
        "/ocr",
        data={"width": "100", "height": "100"},
        files={"image": DUMMY_IMAGE},
    )
    assert resp.status_code == 400


def test_ocr_unknown_mode_rejected():
    resp = client.post(
        "/ocr",
        data={"mode": "yolo", "language": "hi", "width": "100", "height": "100"},
        files={"image": DUMMY_IMAGE},
    )
    assert resp.status_code == 400
