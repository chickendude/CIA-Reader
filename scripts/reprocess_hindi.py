#!/usr/bin/env python3
"""Rebuild Hindi tokens and all-candidate counts directly; starts no web/NLP server."""

import argparse
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "services/nlp"), str(ROOT / "packages/shared-types/python")]
from psycopg import connect
from app.pipelines.hindidb import HindiDBPipeline
from hindi_storage import persist_chapter


def main():
    url = os.environ["DATABASE_URL"]
    from urllib.parse import urlparse

    if urlparse(url).hostname not in ("localhost", "127.0.0.1", "::1"):
        raise SystemExit("This helper only reprocesses a local database.")
    pipeline = HindiDBPipeline()
    with connect(url, autocommit=True) as conn:
        parser = argparse.ArgumentParser(description=__doc__)
        parser.add_argument("--book", action="append", help="Limit to this exact book title")
        parser.add_argument("--stutters-only", action="store_true",
                            help="Update only chapters containing possible stutters")
        args = parser.parse_args()
        chapters = conn.execute("""SELECT ch.id,tx.title FROM text_chapters ch
          JOIN texts tx ON tx.id=ch.text_id WHERE tx.language='hi'
          AND (%s::text[] IS NULL OR tx.title=ANY(%s)) ORDER BY tx.id,ch.idx""",
          (args.book, args.book)).fetchall()
        for chapter_id, title in chapters:
            with conn.transaction():
                body = conn.execute("SELECT body FROM text_chapters WHERE id=%s FOR UPDATE",
                                    (chapter_id,)).fetchone()[0] or ""
                if args.stutters_only and not any(h in body for h in "-‐‑"):
                    continue
                result = pipeline.process(body)
                stats = persist_chapter(conn, chapter_id, body, result,
                                        preserve_phrase_spans=args.stutters_only)
                if stats is None:
                    continue
                spans = stats.get("stutters", [])
                print(f"{title}: {stats['source_words']} words, {len(spans)} stutter candidates",
                      flush=True)
        if not args.stutters_only:
            conn.execute("""UPDATE texts SET status='ready',status_error=NULL WHERE language='hi'
              AND (%s::text[] IS NULL OR title=ANY(%s))
              AND EXISTS(SELECT 1 FROM text_chapters c WHERE c.text_id=texts.id)""",
              (args.book, args.book))


if __name__ == "__main__":
    main()
