"""Dictionary operations shared by the web editor and the HTTP compatibility routes."""

from hindidb.lexicon import Lexicon
from hindidb.morphology import forms


def preview(
    entry_data,
    *,
    include_slots=False,
    inventory=False,
    validate_inventory=False,
    phrase="",
    phrase_candidates=False,
    negative_variants=False,
):
    lexicon = Lexicon(documents=[{"entries": [entry_data]}])
    entry = next(iter(lexicon.entries.values()))
    result = {"forms": {word: sorted(rules) for word, rules in forms(entry).items()}}
    if include_slots:
        from hindidb.form_inventory import slot_pattern_forms, slots

        result["slots"] = [
            {"label": slot["label"], "forms": sorted(words)}
            for slot in slots(entry["pos"], entry.get("paradigm"))
            if (words := slot_pattern_forms(entry, slot))
        ]
    if inventory or validate_inventory:
        from hindidb.form_inventory import build, validate_saved

        if validate_inventory:
            validate_saved(entry_data)
        if inventory:
            result["inventory"] = build(entry, source=entry_data)
    if phrase_candidates:
        from hindidb.phrase_forms import verb_forms

        supported = verb_forms(entry)
        result["forms"] = {
            word: rules for word, rules in result["forms"].items() if word in supported
        }
    if phrase:
        from hindidb.phrase_forms import build as phrase_forms

        result["forms"] = phrase_forms(lexicon, phrase, entry["lemma"], negative_variants)["forms"]
    return result


def reference(*, provider="", query="", url=""):
    from hindidb.dictionary_sources import PROVIDERS, fetch_page, search_dictionary

    if url:
        return fetch_page(url)
    if provider not in PROVIDERS or not query.strip():
        raise ValueError("Choose a dictionary and enter a word")
    return search_dictionary(provider, query)


class ReportNotFoundError(ValueError):
    pass


def workshop_report(name, provider):
    import os
    from copy import copy

    import psycopg

    from hindidb.review_reports import entry_hash, recommendation_rows, spelling_rows

    live, ids, revision = provider.load()
    # Only the editor view needs canonical English wording. Keep parser cache immutable.
    lexicon = copy(live)
    lexicon.entries = live.entries.copy()
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        for key, gloss in conn.execute(
            """SELECT h.external_id,l.gloss_default FROM hindi_entries h
               JOIN lemmas l ON l.id=h.lemma_id WHERE l.language='hi'"""
        ):
            entry = lexicon.entries.get(key)
            if entry is None:
                continue
            meanings = [
                d.get("translation") or (d.get("original") if d.get("language") == "en" else "")
                for d in entry.get("definitions", [])
            ]
            if "; ".join(filter(None, meanings)).strip() != (gloss or ""):
                lexicon.entries[key] = {
                    **entry,
                    "definitions": [{"original": gloss or "", "language": "en"}],
                }
        if name == "spellings":
            report = spelling_rows(lexicon)
            rows = [
                {
                    **r,
                    "id": ids[r["source_id"]],
                    "target": ids.get(r.get("target_id")),
                    "state": "ready" if eligible else "skipped",
                    "reason": r.get("reason", ""),
                }
                for eligible, subset in [(True, report["ready"]), (False, report["skipped"])]
                for r in subset
            ]
        else:
            stored = conn.execute(
                "SELECT result FROM hindi_reference_cache WHERE key=%s", ("report:" + name,)
            ).fetchone()
            if not stored:
                raise ReportNotFoundError("Recommendation report not found")
            rows = [{**r, "id": ids.get(r["id"])} for r in recommendation_rows(lexicon, stored[0])]
    return {"rows": rows, "fingerprint": entry_hash([revision, name, rows])}
