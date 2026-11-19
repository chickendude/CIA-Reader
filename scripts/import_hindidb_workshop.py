"""Copy HindiDB reference material into Parhiba's PostgreSQL workshop cache."""
import argparse
from collections import defaultdict
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sqlite3
import sys

import psycopg
from psycopg.types.json import Jsonb

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services/nlp"))
from hindidb.lexicon import lexical_id


def reference_rows(project):
    directory = project / ".hindidb"
    stamp = datetime.now(timezone.utc)
    source = json.loads((directory / "wiktionary-base.json").read_text())
    # The import runs beside the source project, so it can use HindiDB's
    # own etymology rules and POS refinements from that snapshot.
    import hindidb
    hindidb.__path__.append(str(project.resolve() / "hindidb"))
    from hindidb.loanwords import is_english_loan, loan_index

    loans = loan_index(directory)
    overrides = json.loads((directory / "lexicon.json").read_text()).get("entries", [])
    loan_words = {}
    for entry in [*source["entries"], *overrides]:
        loan_words[lexical_id(entry["lemma"], entry["pos"])] = is_english_loan(entry, loans)
    for key, loan in loan_words.items():
        if loan:
            yield "loan:" + key, True, stamp
    index = defaultdict(list)
    for entry in source["entries"]:
        key = lexical_id(entry["lemma"], entry["pos"])
        yield "foundation:" + key, entry, stamp
        for word in {entry["lemma"], *entry.get("alternative_headwords", []), *entry.get("forms", [])}:
            index[word].append(key)
    for word, keys in index.items():
        yield "wiki:" + word, keys, stamp
    for path in sorted((directory / "reports").glob("*/review.json")):
        report = json.loads(path.read_text())
        if report.get("entries") and all("source_entry" in e and "decision" in e for e in report["entries"]):
            fields = ("entry_id", "lemma", "pos", "decision", "reason", "meaning", "base", "components",
                      "source_urls", "source_entry")
            yield "report:" + path.parent.name, {"entries": [
                {k: e[k] for k in fields if k in e} for e in report["entries"]
            ]}, stamp
    evidence = directory / "review.sqlite3"
    if evidence.exists():
        with sqlite3.connect(evidence.resolve().as_uri() + "?mode=ro", uri=True) as src:
            def cache_key(items):
                return json.dumps(items, ensure_ascii=False, separators=(",", ":"))
            for url, payload, retrieved in src.execute("SELECT url,payload,retrieved_at FROM pages"):
                yield cache_key([None, None, url]), json.loads(payload), retrieved
            for provider, word, payload, retrieved in src.execute("SELECT provider,query,payload,retrieved_at FROM searches"):
                yield cache_key([provider, word, None]), json.loads(payload), retrieved
            excerpts = defaultdict(list)
            for (payload,) in src.execute("SELECT payload FROM excerpts ORDER BY created_at,id"):
                e = json.loads(payload)
                excerpts[e["headword"]].append({"url": e["source_url"], "original": e["original"],
                    "english": e.get("translation") or (e["original"] if e.get("language") == "en" else "")})
            for word, values in excerpts.items():
                yield "excerpts:" + word, values, stamp


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("hindidb", type=Path)
    args = parser.parse_args()
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        conn.execute("CREATE TEMP TABLE workshop_import (LIKE hindi_reference_cache) ON COMMIT DROP")
        with conn.cursor().copy("COPY workshop_import(key,result,retrieved_at) FROM STDIN") as out:
            for key, payload, retrieved in reference_rows(args.hindidb):
                out.write_row((key, Jsonb(payload), retrieved))
        added = conn.execute("""INSERT INTO hindi_reference_cache(key,result,retrieved_at)
            SELECT coalesce('loan:' || h.lemma_id, w.key), w.result, w.retrieved_at FROM workshop_import w
            LEFT JOIN hindi_entries h ON starts_with(w.key, 'loan:') AND h.external_id=substr(w.key, 6)
            ON CONFLICT (key) DO NOTHING""").rowcount
        library = args.hindidb / ".hindidb/library.sqlite3"
        if library.exists():
            with sqlite3.connect(library.resolve().as_uri() + "?mode=ro", uri=True) as src:
                for book_id, form in src.execute("SELECT book_id,form FROM review_ignored_forms"):
                    # The import marker keeps a later restore effective on repeated imports.
                    key = "ignored:" + json.dumps([book_id, form], ensure_ascii=False)
                    conn.execute("""WITH book AS (SELECT text_id FROM hindi_imported_books WHERE source_version_id=%s),
                        imported AS (INSERT INTO hindi_reference_cache(key,result) SELECT %s,'true'::jsonb FROM book
                          ON CONFLICT DO NOTHING RETURNING key)
                        INSERT INTO hindi_review_ignored(text_id,surface) SELECT text_id,%s FROM book,imported
                        ON CONFLICT DO NOTHING""", (book_id, key, form))
    print(f"Added {added:,} reference records to the workshop.")


if __name__ == "__main__":
    main()
