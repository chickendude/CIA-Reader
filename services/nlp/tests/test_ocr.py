"""Tests for the /ocr endpoint and its OCR helpers.

The default lane never touches Google Vision: the born-digital path needs
no OCR at all, the Vision endpoint path is exercised by monkeypatching
``run_vision_ocr``, and the Vision parser is unit-tested against a fake
annotation. So nothing here requires the ``[ocr]`` extra.
"""

from __future__ import annotations

import json
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.main import app
from app.ocr.align import OcrPage, assign_token_boxes, union_boxes
from app.ocr.borndigital import build_born_digital_page
from app.ocr.vision import build_ocr_page
from app.schemas import BBox, Token

client = TestClient(app)

# A tiny stand-in for the uploaded page image. The born-digital path
# ignores the bytes; the monkeypatched Vision path never decodes them.
DUMMY_IMAGE = ("page.webp", b"\x00\x01\x02\x03", "image/webp")


def _born_digital_items() -> list[dict]:
    # Two runs on line one (joined by a space), then a line break, then a
    # run on line two. Coords are normalized 0..1, top-left origin.
    return [
        {"str": "Egun", "x": 0.10, "y": 0.10, "w": 0.20, "h": 0.05},
        {"str": "on", "x": 0.35, "y": 0.10, "w": 0.10, "h": 0.05, "eol": True},
        {"str": "mundua", "x": 0.10, "y": 0.20, "w": 0.30, "h": 0.05},
    ]


def test_ocr_born_digital_assigns_boxes():
    resp = client.post(
        "/ocr",
        data={
            "language": "eu",
            "width": "1000",
            "height": "1400",
            "born_digital": json.dumps({"items": _born_digital_items()}),
        },
        files={"image": DUMMY_IMAGE},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["language"] == "eu"
    assert body["pipeline_id"] == "stanza-eu"
    assert body["width"] == 1000
    assert body["height"] == 1400
    # Runs joined with a space (line 1) and a newline (after the eol run).
    assert body["body"] == "Egun on\nmundua"

    words = [t for t in body["tokens"] if t["is_word"]]
    assert [w["surface"] for w in words] == ["Egun", "on", "mundua"]
    # Every word got a box; the first matches its source run.
    assert all(w["bbox"] is not None for w in words)
    assert words[0]["bbox"]["x"] == 0.10
    assert words[0]["bbox"]["w"] == 0.20


def test_ocr_vision_path_uses_char_boxes(monkeypatch):
    # "Egun on": one box for the first word, another for the second; the
    # space carries no box.
    box_a = BBox(x=0.1, y=0.1, w=0.2, h=0.05)
    box_b = BBox(x=0.4, y=0.1, w=0.1, h=0.05)
    page = OcrPage(
        text="Egun on",
        char_boxes=[box_a, box_a, box_a, box_a, None, box_b, box_b],
    )
    monkeypatch.setattr("app.main.run_vision_ocr", lambda _bytes: page)

    resp = client.post(
        "/ocr",
        data={"language": "eu", "width": "800", "height": "1200"},
        files={"image": DUMMY_IMAGE},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    words = [t for t in body["tokens"] if t["is_word"]]
    assert [w["surface"] for w in words] == ["Egun", "on"]
    assert words[0]["bbox"] == {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.05}
    assert words[1]["bbox"] == {"x": 0.4, "y": 0.1, "w": 0.1, "h": 0.05}


def test_ocr_layout_replays_stored_boxes_without_vision(monkeypatch):
    # The free-reprocess path: a stored layout (page text + per-char boxes)
    # re-tokenizes with the current model and must NOT call Vision.
    def _boom(_bytes):
        raise AssertionError("Vision must not be called on the layout path")

    monkeypatch.setattr("app.main.run_vision_ocr", _boom)
    a = [0.1, 0.1, 0.05, 0.05]
    b = [0.4, 0.1, 0.05, 0.05]
    layout = {"text": "Egun on", "char_boxes": [a, a, a, a, None, b, b]}
    resp = client.post(
        "/ocr",
        data={
            "language": "eu",
            "width": "800",
            "height": "1200",
            "layout": json.dumps(layout),
        },
        files={"image": DUMMY_IMAGE},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    words = [t for t in body["tokens"] if t["is_word"]]
    assert [w["surface"] for w in words] == ["Egun", "on"]
    assert words[0]["bbox"] == {"x": 0.1, "y": 0.1, "w": 0.05, "h": 0.05}
    assert words[1]["bbox"] == {"x": 0.4, "y": 0.1, "w": 0.05, "h": 0.05}


def test_ocr_rejects_unsupported_language():
    resp = client.post(
        "/ocr",
        data={"language": "ja", "width": "100", "height": "100"},
        files={"image": DUMMY_IMAGE},
    )
    assert resp.status_code == 400


def test_ocr_rejects_invalid_born_digital_json():
    resp = client.post(
        "/ocr",
        data={
            "language": "eu",
            "width": "100",
            "height": "100",
            "born_digital": "{not json",
        },
        files={"image": DUMMY_IMAGE},
    )
    assert resp.status_code == 400


def test_union_boxes_ignores_none_and_covers_all():
    assert union_boxes([None, None]) is None
    u = union_boxes(
        [
            BBox(x=0.1, y=0.1, w=0.1, h=0.1),
            None,
            BBox(x=0.3, y=0.2, w=0.1, h=0.2),
        ]
    )
    assert u == BBox(x=0.1, y=0.1, w=0.3, h=0.3)


def test_assign_token_boxes_handles_repeated_words():
    # "ba ba" — the forward scan must give each occurrence its own box.
    a = BBox(x=0.0, y=0.0, w=0.1, h=0.1)
    b = BBox(x=0.5, y=0.0, w=0.1, h=0.1)
    page = OcrPage(text="ba ba", char_boxes=[a, a, None, b, b])
    tokens = [
        Token(idx=0, surface="ba", is_word=True),
        Token(idx=1, surface=" ", is_word=False),
        Token(idx=2, surface="ba", is_word=True),
    ]
    boxes = assign_token_boxes(tokens, page)
    assert boxes[0] == a
    assert boxes[1] is None
    assert boxes[2] == b


def test_build_ocr_page_from_vision_annotation():
    # Fake Vision hierarchy: page(100x200) → block → paragraph → word → symbols.
    def sym(text, x0, y0, x1, y1, brk=0):
        vertices = [
            SimpleNamespace(x=x0, y=y0),
            SimpleNamespace(x=x1, y=y0),
            SimpleNamespace(x=x1, y=y1),
            SimpleNamespace(x=x0, y=y1),
        ]
        prop = SimpleNamespace(
            detected_break=SimpleNamespace(type_=brk)
        )
        return SimpleNamespace(
            text=text,
            bounding_box=SimpleNamespace(vertices=vertices),
            property=prop,
        )

    word1 = SimpleNamespace(
        symbols=[sym("H", 10, 10, 20, 30), sym("i", 22, 10, 28, 30, brk=1)]
    )
    word2 = SimpleNamespace(
        symbols=[sym("y", 40, 10, 48, 30), sym("o", 50, 10, 58, 30, brk=4)]
    )
    para = SimpleNamespace(words=[word1, word2])
    block = SimpleNamespace(paragraphs=[para])
    page = SimpleNamespace(width=100, height=200, blocks=[block])
    annotation = SimpleNamespace(pages=[page])

    ocr_page = build_ocr_page(annotation)
    # SPACE break after "i", LINE_BREAK after "o".
    assert ocr_page.text == "Hi yo\n"
    assert len(ocr_page.char_boxes) == len(ocr_page.text)
    # First glyph normalized by the page dims (10/100, 10/200, ...).
    assert ocr_page.char_boxes[0] == BBox(x=0.1, y=0.05, w=0.1, h=0.1)
    # The space carries no box.
    assert ocr_page.char_boxes[2] is None


def test_build_ocr_page_hyphen_break_separates_words():
    # Regression: Vision emits HYPHEN (break type 5) at ordinary line/block
    # ends in some scanned docs, not just for split words. It must insert a
    # separator, otherwise the line-final word glues to the next line's
    # first word ("Erraza" + "4.3.1." → "Erraza4.3.1.") and their boxes
    # merge into one tall box over neighbouring words.
    def sym(text, x0, brk=0):
        vertices = [
            SimpleNamespace(x=x0, y=0),
            SimpleNamespace(x=x0 + 10, y=0),
            SimpleNamespace(x=x0 + 10, y=10),
            SimpleNamespace(x=x0, y=10),
        ]
        return SimpleNamespace(
            text=text,
            bounding_box=SimpleNamespace(vertices=vertices),
            property=SimpleNamespace(detected_break=SimpleNamespace(type_=brk)),
        )

    # "Erraza" ends a line with a HYPHEN break; "4" begins the next line.
    w1 = SimpleNamespace(symbols=[sym("Erraza", 0, brk=5)])
    w2 = SimpleNamespace(symbols=[sym("4", 0, brk=0)])
    para = SimpleNamespace(words=[w1, w2])
    block = SimpleNamespace(paragraphs=[para])
    page = SimpleNamespace(width=100, height=100, blocks=[block])
    ocr_page = build_ocr_page(SimpleNamespace(pages=[page]))

    assert "Erraza4" not in ocr_page.text
    assert ocr_page.text == "Erraza\n4"


def test_build_born_digital_page_splits_run_box_across_chars():
    page = build_born_digital_page(
        [{"str": "ab", "x": 0.0, "y": 0.0, "w": 0.2, "h": 0.1}]
    )
    assert page.text == "ab"
    # The 0.2-wide run is split evenly across its two characters.
    assert page.char_boxes[0] == BBox(x=0.0, y=0.0, w=0.1, h=0.1)
    assert page.char_boxes[1] == BBox(x=0.1, y=0.0, w=0.1, h=0.1)
