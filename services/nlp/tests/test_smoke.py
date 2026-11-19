from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_ok():
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert set(body["languages"]) == {"hi", "mr", "or", "yi", "eu"}


def test_healthz_alias_returns_same_payload():
    # /healthz is the canonical name; /health stays as a
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
    assert body["pipeline_id"] == "hindidb-hi"
    assert len(body["tokens"]) == 3
    assert body["hindi_analysis"]["stats"]["source_words"] == 2
    assert body["tokens"][0]["surface"] == "नमस्ते"


def test_process_odia_canned():
    resp = client.post("/process", json={"language": "or", "text": "ନମସ୍କାର ଦୁନିଆ"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["language"] == "or"
    assert body["pipeline_id"] == "dictionary-or"
    # Two words plus a whitespace gap token between them — the gap is
    # required so the reader can break lines (otherwise the chapter
    # renders as one unbreakable run).
    word_tokens = [t for t in body["tokens"] if t["is_word"]]
    assert len(word_tokens) == 2


def test_process_yiddish_canned():
    resp = client.post("/process", json={"language": "yi", "text": "איך שרייַב אַ בוך"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["language"] == "yi"
    assert body["pipeline_id"] == "dictionary-yi"
    word_tokens = [t for t in body["tokens"] if t["is_word"]]
    assert len(word_tokens) == 4
    shrayb = word_tokens[1]
    assert shrayb["candidates"] == []
    assert shrayb["romanization"] == "shrayb"


def test_process_basque_canned():
    # plus the whitespace gap tokens between them — rather than exact lemmas.
    resp = client.post("/process", json={"language": "eu", "text": "Egun on mundua"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["language"] == "eu"
    assert body["pipeline_id"] == "dictionary-eu"
    word_tokens = [t for t in body["tokens"] if t["is_word"]]
    assert len(word_tokens) == 3
    # Latin script — no romanization layer is produced.
    assert all(t["romanization"] is None for t in word_tokens)


def test_process_rejects_unsupported_language():
    resp = client.post("/process", json={"language": "ja", "text": "hello"})
    assert resp.status_code == 400


def test_process_hindi_preserves_original_input_offsets():
    # HindiDB normalizes matching internally while retaining source surfaces.
    precomposed = "\u0958"
    resp = client.post("/process", json={"language": "hi", "text": precomposed})
    assert resp.status_code == 200
    body = resp.json()
    assert body["tokens"][0]["surface"] == precomposed


def test_process_empty_text_rejected_by_validation():
    resp = client.post("/process", json={"language": "hi", "text": ""})
    assert resp.status_code == 422
