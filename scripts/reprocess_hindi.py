#!/usr/bin/env python3
"""Rebuild Hindi tokens and all-candidate counts directly; starts no web/NLP server."""

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
        chapters = conn.execute("""SELECT ch.id,ch.text_id,ch.body,tx.title FROM text_chapters ch
          JOIN texts tx ON tx.id=ch.text_id WHERE tx.language='hi' ORDER BY tx.id,ch.idx""").fetchall()
        for index, (chapter_id, text_id, body, title) in enumerate(chapters):
            if not body:
                body = ""
            result = pipeline.process(body)
            stats = persist_chapter(conn, chapter_id, body, result)
            analysis = result.hindi_analysis
            print(
                f"{index + 1}/{len(chapters)} {title}: {stats['source_words']} words, {len(analysis['occurrences'])} candidate matches",
                flush=True,
            )
        conn.execute(
            "UPDATE texts SET status='ready',status_error=NULL WHERE language='hi' AND EXISTS(SELECT 1 FROM text_chapters c WHERE c.text_id=texts.id)"
        )


if __name__ == "__main__":
    main()
