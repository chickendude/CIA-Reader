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


def test_healthz_alias_returns_same_payload():
    # /healthz is the canonical name (T-13.5); /health stays as a
    # backwards-compat alias for callers like the dev compose
    # Dockerfile healthcheck.
    resp_health = client.get("/health")
    resp_healthz = client.get("/healthz")
    assert resp_healthz.status_code == 200
    assert resp_healthz.json() == resp_health.json()


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


def test_process_nfc_normalizes_input():
    # Devanagari क़ (U+0958) is a Unicode composition exclusion — NFC
    # canonicalizes it to the decomposed form क (U+0915) + nukta (U+093C).
    # Sending the precomposed form and getting the decomposed surface back
    # proves the /process endpoint ran NFC normalization.
    precomposed = "\u0958"
    canonical = "\u0915\u093c"
    resp = client.post("/process", json={"language": "hi", "text": precomposed})
    assert resp.status_code == 200
    body = resp.json()
    assert body["tokens"][0]["surface"] == canonical


def test_process_empty_text_rejected_by_validation():
    resp = client.post("/process", json={"language": "hi", "text": ""})
    assert resp.status_code == 422
