#!/usr/bin/env python3
"""Import current Harry Potter books and occurrence choices into local Parhiba.

Reads HindiDB's SQLite database in read-only mode. Dry-run unless --apply;
completed imports are skipped so subsequent Parhiba edits are never overwritten.
"""

import argparse
from bisect import bisect_left
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import os
import re
from pathlib import Path
import sqlite3
import subprocess
import sys
from typing import NamedTuple
from urllib.parse import urlparse
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "services/nlp"), str(ROOT / "packages/shared-types/python")]
from psycopg import connect
from psycopg.types.json import Jsonb
from app.pipelines.hindidb import HindiDBPipeline
from hindi_storage import persist_chapter


class Chapter(NamedTuple):
    start: int
    end: int
    title: str


# The first book prints पंद्र्रह for fifteen. Keep its spelling in the body.
NUMBERS = (
    "एक दो तीन चार पाँच छह सात आठ नौ दस ग्यारह बारह तेरह चौदह पंद्रह सोलह सत्रह अठारह"
).split()
CHAPTER_COUNTS = {"harry potter 1": 17, "harry potter 2": 18}
HEADING = re.compile(r"^अध्याय[ \t]*-[ \t]*([^\s]+)[ \t\r]*$", re.MULTILINE)


def partition(text, protected_spans, target=14000):
    """Keep exact source text and avoid splitting sentences or lexical spans."""
    spans = sorted(protected_spans)
    starts, ends = [], []
    for start, end in spans:
        starts.append(start)
        ends.append(max(end, ends[-1] if ends else 0))
    start = 0
    while start < len(text):
        end = min(start + target, len(text))
        if end < len(text):
            boundary = text.rfind("\n", start + target // 2, end)
            if boundary >= 0:
                end = boundary + 1
            while True:
                previous = bisect_left(starts, end) - 1
                crossing_end = ends[previous] if previous >= 0 else end
                if crossing_end <= end:
                    break
                end = crossing_end
        yield start, end, text[start:end]
        start = end


def source_chapters(title, text, protected_spans=()):
    if title.lower() not in CHAPTER_COUNTS:
        return [
            Chapter(start, end, f"Part {i + 1}")
            for i, (start, end, _) in enumerate(partition(text, protected_spans))
        ]
    expected = CHAPTER_COUNTS[title.lower()]
    headings = list(HEADING.finditer(text))
    numbers = [m[1].replace("पंद्र्रह", "पंद्रह") for m in headings]
    if numbers != NUMBERS[:expected]:
        raise ValueError(f"{title} must have all {expected} numbered headings in order")
    chapters = []
    for index, heading in enumerate(headings):
        end = headings[index + 1].start() if index + 1 < expected else len(text)
        lines = text[heading.end() : end].lstrip().splitlines()
        if not lines:
            raise ValueError(f"Missing chapter title after {heading[0]}")
        # Keep the dedication and title page at the beginning of the first chapter.
        chapters.append(Chapter(heading.start() if index else 0, end, lines[0].strip()))
    return chapters


def read_books(source):
    path = source / ".hindidb/library.sqlite3"
    with sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        db.execute("BEGIN")
        books = [
            dict(r)
            for r in db.execute("""
            SELECT b.*,a.analysis_id FROM books b JOIN active_analyses a ON a.book_id=b.id
            WHERE lower(b.title) LIKE '%harry potter%'
              AND b.id NOT IN (SELECT original_id FROM book_replacements)
            ORDER BY b.title,b.id""")
        ]
        for book in books:
            selected = defaultdict(list)
            for row in db.execute(
                """SELECT d.id,e.entry_id FROM occurrence_locations l
                JOIN occurrence_choices c ON c.occurrence_id=l.occurrence_id
                JOIN occurrence_decisions d ON d.id=c.decision_id
                JOIN decision_entries e ON e.decision_id=d.id WHERE l.version_id=?""",
                (book["id"],),
            ):
                selected[row["id"]].append(row["entry_id"])
            book["choices"] = []
            for row in db.execute(
                """SELECT d.*,l.start,l.end,l.surface AS current_surface,
                l.mapping_status,s.text AS current_sentence FROM occurrence_locations l
                JOIN occurrence_choices c ON c.occurrence_id=l.occurrence_id
                JOIN occurrence_decisions d ON d.id=c.decision_id
                LEFT JOIN occurrence_sentences s ON s.version_id=l.version_id AND s.number=l.sentence
                WHERE l.version_id=? ORDER BY l.start,l.end""",
                (book["id"],),
            ):
                choice = dict(row)
                choice["selected_entries"] = sorted(selected[choice["id"]])
                choice["candidate_snapshot"] = json.loads(choice["candidate_snapshot"])
                book["choices"].append(choice)
            book["spans"] = [
                tuple(r)
                for r in db.execute(
                    """
                SELECT start,end FROM occurrence_locations WHERE version_id=?
                UNION SELECT start,end FROM occurrence_sentences WHERE version_id=?""",
                    (book["id"], book["id"]),
                )
            ]
            book["sources"] = [
                r[0]
                for r in db.execute(
                    "SELECT path FROM sources WHERE book_id=?", (book["id"],)
                )
            ]
        return books


def choice_status(choice, body, offset, supported, identities):
    snapshot = choice["candidate_snapshot"]
    expected = {identities[e["id"]][0] for e in snapshot if e["id"] in identities}
    identities_match = all(
        e["id"] in identities and identities[e["id"]][1:] == (e["lemma"], e["pos"])
        for e in snapshot
    )
    selected = [
        identities[key][0] for key in choice["selected_entries"] if key in identities
    ]
    start, end = choice["start"] - offset, choice["end"] - offset
    stale = (
        not identities_match
        or expected != supported
        or len(selected) != len(choice["selected_entries"])
        or choice["surface"] != choice["current_surface"]
        or choice["sentence_text"] != choice["current_sentence"]
        or body[start:end] != choice["surface"]
    )
    status = "needs_review" if stale else choice["outcome"]
    if not stale and status == "selected":
        status = "confirmed" if choice["origin"] == "human" else "ai_suggested"
    return selected, sorted(expected), status


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--owner", required=True, help="Local Parhiba user UUID")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    os.umask(0o077)
    url = os.environ["DATABASE_URL"]
    if urlparse(url).hostname not in ("localhost", "127.0.0.1", "::1"):
        raise SystemExit("This tool only imports into a local database.")
    books = read_books(args.source)
    if not books:
        raise SystemExit("No current Harry Potter books found.")
    for book in books:
        book["chapters"] = source_chapters(book["title"], book["text"], book["spans"])
        counts = Counter(f"{c['origin']}:{c['outcome']}" for c in book["choices"])
        print(
            json.dumps(
                {
                    "title": book["title"],
                    "version": book["id"],
                    "characters": len(book["text"]),
                    "chapters": len(book["chapters"]),
                    "choices": counts,
                },
                ensure_ascii=False,
            ),
            flush=True,
        )
    if not args.apply:
        return
    with connect(url, autocommit=True) as conn:
        if not conn.execute(
            "SELECT 1 FROM users WHERE id=%s", (args.owner,)
        ).fetchone():
            raise SystemExit("Owner does not exist in local Parhiba.")
        pending = []
        for book in books:
            previous = conn.execute(
                """SELECT b.content_hash,t.owner_id FROM hindi_imported_books b
                JOIN texts t ON t.id=b.text_id WHERE source_version_id=%s""",
                (book["id"],),
            ).fetchone()
            digest = hashlib.sha256(book["text"].encode()).hexdigest()
            if previous:
                if previous[0] != digest or str(previous[1]) != args.owner:
                    raise SystemExit(
                        "Existing import has a different source hash or owner; refusing overwrite."
                    )
                print(
                    f"Already imported: {book['title']}; keeping Parhiba edits.",
                    flush=True,
                )
            else:
                pending.append(book)
        if not pending:
            return
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup = ROOT / ".local/backups" / f"before-hindidb-books-{stamp}.dump"
        backup.parent.mkdir(parents=True, exist_ok=True)
        with backup.open("xb") as stream:
            subprocess.run(
                [
                    "pg_dump",
                    "--format=custom",
                    "--no-owner",
                    "--no-privileges",
                    "--dbname",
                    url,
                ],
                stdout=stream,
                check=True,
            )
        archive = ROOT / ".local/hindidb-books" / stamp
        archive.mkdir(parents=True)
        for book in pending:
            (archive / f"{book['id']}.json").write_text(
                json.dumps(book, ensure_ascii=False) + "\n"
            )
        print(f"Backup: {backup}\nSource archive: {archive}", flush=True)
        identities = {
            external: (str(uid), lemma, pos)
            for external, uid, lemma, pos in conn.execute("""
            SELECT h.external_id,l.id,l.headword,l.pos FROM hindi_entries h JOIN lemmas l ON l.id=h.lemma_id""")
        }
        pipeline = HindiDBPipeline()
        for book in pending:
            counts = Counter()
            with conn.transaction():
                conn.execute(
                    "SELECT pg_advisory_xact_lock(hashtext('hindidb-books-import'))"
                )
                if conn.execute(
                    "SELECT 1 FROM hindi_imported_books WHERE source_version_id=%s",
                    (book["id"],),
                ).fetchone():
                    raise RuntimeError("Another import completed; rerun to skip it.")
                text_id = uuid4()
                conn.execute(
                    """INSERT INTO texts(id,owner_id,language,title,source_type,status,visibility)
                    VALUES(%s,%s,'hi',%s,'txt','processing','private')""",
                    (text_id, args.owner, book["title"]),
                )
                chapters = book["chapters"]
                choice_index = 0
                for index, (start, end, title) in enumerate(chapters):
                    body = book["text"][start:end]
                    chapter_id = uuid4()
                    conn.execute(
                        "INSERT INTO text_chapters(id,text_id,idx,title,body) VALUES(%s,%s,%s,%s,%s)",
                        (chapter_id, text_id, index, title, body),
                    )
                    result = pipeline.process(body)
                    stats = persist_chapter(conn, chapter_id, body, result)
                    supported = defaultdict(set)
                    for occurrence in result.hindi_analysis["occurrences"]:
                        supported[
                            occurrence["source_start"], occurrence["source_end"]
                        ].add(occurrence["lemma_id"])
                    chapter_hash = hashlib.md5(body.encode()).hexdigest()
                    with (
                        conn.cursor().copy("""COPY hindi_context_choices(chapter_id,source_occurrence_id,source_start,
                        source_end,selected_lemma_ids,candidate_lemma_ids,origin,status,metadata) FROM STDIN""") as copy
                    ):
                        while (
                            choice_index < len(book["choices"])
                            and book["choices"][choice_index]["start"] < end
                        ):
                            choice = book["choices"][choice_index]
                            assert start <= choice["start"] < choice["end"] <= end, (
                                "Choice split across chapters"
                            )
                            span = choice["start"] - start, choice["end"] - start
                            selected, candidates, status = choice_status(
                                choice, body, start, supported[span], identities
                            )
                            metadata = {
                                **choice,
                                "source_version_id": book["id"],
                                "chapter_source_start": start,
                                "chapter_hash": chapter_hash,
                            }
                            copy.write_row(
                                (
                                    chapter_id,
                                    choice["occurrence_id"],
                                    *span,
                                    Jsonb(selected),
                                    Jsonb(candidates),
                                    choice["origin"],
                                    status,
                                    Jsonb(metadata),
                                )
                            )
                            counts[status] += 1
                            choice_index += 1
                    print(
                        f"{book['title']} {index + 1}/{len(chapters)}: {stats['source_words']} words",
                        flush=True,
                    )
                assert choice_index == len(book["choices"]), (
                    "Not every source choice was imported"
                )
                conn.execute("UPDATE texts SET status='ready' WHERE id=%s", (text_id,))
                conn.execute(
                    "INSERT INTO hindi_imported_books VALUES(%s,%s,%s,%s)",
                    (
                        book["id"],
                        text_id,
                        hashlib.sha256(book["text"].encode()).hexdigest(),
                        Jsonb(
                            {
                                "title": book["title"],
                                "sources": book["sources"],
                                "source_content_hash": book["content_hash"],
                                "source_analysis_id": book["analysis_id"],
                                "archive": str(archive),
                                "backup": str(backup),
                                "imported_at": stamp,
                                "choice_counts": dict(counts),
                                "chapter_offsets": [[s, e] for s, e, _ in chapters],
                            }
                        ),
                    ),
                )
            print(f"Imported {book['title']} ({text_id}): {dict(counts)}", flush=True)


if __name__ == "__main__":
    main()
