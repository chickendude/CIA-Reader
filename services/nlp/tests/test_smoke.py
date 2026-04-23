from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_ok():
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert set(body["languages"]) == {"hi", "mr", "or"}


def test_process_hindi_canned():
    resp = client.post("/process", json={"language": "hi", "text": "नमस्ते दुनिया"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["language"] == "hi"
    assert body["pipeline_id"] == "stanza-hi"
    assert len(body["tokens"]) == 2
    assert body["tokens"][0]["surface"] == "नमस्ते"


def test_process_odia_canned():
    resp = client.post("/process", json={"language": "or", "text": "ନମସ୍କାର ଦୁନିଆ"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["language"] == "or"
    assert body["pipeline_id"] == "custom-or"
    assert len(body["tokens"]) == 2


def test_process_rejects_unsupported_language():
    resp = client.post("/process", json={"language": "ja", "text": "hello"})
    assert resp.status_code == 400
