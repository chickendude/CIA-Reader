#!/usr/bin/env python3
"""Regroup legacy Harry Potter reader parts using the headings in the imported text."""

import argparse
from bisect import bisect_left
from collections import Counter
from hashlib import md5, sha256
import os
from urllib.parse import urlparse
from uuid import uuid4

from psycopg import connect
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from import_hindidb_books import CHAPTER_COUNTS, source_chapters
from hindidb.text import normalize, tokenize


def move_rows(db, text_id, old_ids):
    # A segment is the overlap of one old part with one new chapter. The two
    # deltas translate character offsets and reader token indices independently.
    db.execute("""UPDATE text_tokens t SET chapter_id=s.dst, idx=t.idx+s.tokens,
        sentence_idx=CASE WHEN btrim(t.surface, E' \t\n\r')='' THEN 0
                          ELSE t.sentence_idx+s.sentences END
        FROM segments s WHERE t.chapter_id=s.src AND t.idx>=s.lo AND t.idx<s.hi""")
    db.execute("""UPDATE hindi_occurrences o SET chapter_id=s.dst,
        start_idx=o.start_idx+s.tokens,end_idx=o.end_idx+s.tokens,
        source_start=o.source_start+s.chars,source_end=o.source_end+s.chars
        FROM segments s WHERE o.chapter_id=s.src AND o.start_idx>=s.lo AND o.end_idx<=s.hi
          AND o.source_start>=s.first_char AND o.source_end<=s.last_char""")
    db.execute("""UPDATE hindi_context_choices c SET chapter_id=s.dst,
        source_start=c.source_start+s.chars,source_end=c.source_end+s.chars,
        source_occurrence_id=CASE WHEN c.source_occurrence_id=
            concat('parhiba:',c.source_start,':',c.source_end)
          THEN concat('parhiba:',c.source_start+s.chars,':',c.source_end+s.chars)
          ELSE c.source_occurrence_id END,
        metadata=c.metadata || CASE WHEN c.metadata ? 'chapter_source_start'
            THEN jsonb_build_object('chapter_source_start',s.chapter_start) ELSE '{}'::jsonb END
          || CASE WHEN c.metadata->>'chapter_hash'=s.old_hash
            THEN jsonb_build_object('chapter_hash',s.new_hash) ELSE '{}'::jsonb END
        FROM segments s WHERE c.chapter_id=s.src AND c.source_start>=s.first_char
          AND c.source_end<=s.last_char""")
    db.execute("""UPDATE phrase_chapter_spans p SET chapter_id=s.dst,
        start_token_idx=p.start_token_idx+s.tokens,end_token_idx=p.end_token_idx+s.tokens
        FROM segments s WHERE p.chapter_id=s.src AND p.start_token_idx>=s.lo
          AND p.end_token_idx<s.hi""")
    db.execute("""UPDATE user_known_lemmas m SET mined_chapter_id=s.dst,
        mined_token_idx=m.mined_token_idx+s.tokens FROM segments s
        WHERE m.mined_chapter_id=s.src AND m.mined_token_idx>=s.lo AND m.mined_token_idx<s.hi""")
    # Old parts temporarily have negative chapter indices. Recording the token
    # ID before moving it also makes the progress check independent of the offsets.
    db.execute(
        """UPDATE user_text_progress p SET last_chapter_idx=c.idx,last_token_idx=t.idx
        FROM progress_anchors a JOIN text_tokens t ON t.id=a.token_id
        JOIN text_chapters c ON c.id=t.chapter_id
        WHERE p.user_id=a.user_id AND p.text_id=%s""",
        (text_id,),
    )

    # Only derived chapter totals may cascade. A span crossing a heading or an
    # attachment without a token anchor needs an explicit mapping.
    for table, column in (
        ("text_tokens", "chapter_id"),
        ("hindi_occurrences", "chapter_id"),
        ("hindi_context_choices", "chapter_id"),
        ("phrase_chapter_spans", "chapter_id"),
        ("user_known_lemmas", "mined_chapter_id"),
        ("audio_files", "chapter_id"),
        ("phrase_proposals", "chapter_id"),
    ):
        if db.execute(
            f"SELECT 1 FROM {table} WHERE {column}=ANY(%s) LIMIT 1", (old_ids,)
        ).fetchone():
            raise ValueError(f"Could not map every {table} record")


def repair(db, book):
    text_id = book["id"]
    old = db.execute(
        """SELECT c.*,a.revision,a.parser_version,a.stats FROM text_chapters c
        LEFT JOIN hindi_chapter_analyses a ON a.chapter_id=c.id
        WHERE c.text_id=%s ORDER BY idx FOR UPDATE OF c""",
        (text_id,),
    ).fetchall()
    text = "".join(c["body"] for c in old)
    if sha256(text.encode()).hexdigest() != book["content_hash"]:
        raise ValueError("This book has text edits since import")
    chapters = source_chapters(book["source_title"], text)
    if [(c["idx"], c["title"], c["body"]) for c in old] == [
        (i, ch.title, text[ch.start : ch.end]) for i, ch in enumerate(chapters)
    ]:
        print(f"{book['title']} already has its {len(chapters)} chapters", flush=True)
        return
    if any(
        c["idx"] != i
        or c["title"] != f"Part {i + 1}"
        or c["page_image_key"]
        or not c["stats"]
        for i, c in enumerate(old)
    ):
        raise ValueError("Expected the original reader parts with complete analyses")
    db.execute("TRUNCATE segments, progress_anchors")
    db.execute(
        """INSERT INTO progress_anchors SELECT p.user_id,t.id FROM user_text_progress p
        LEFT JOIN text_chapters c ON c.text_id=p.text_id AND c.idx=p.last_chapter_idx
        LEFT JOIN text_tokens t ON t.chapter_id=c.id AND t.idx=p.last_token_idx
        WHERE p.text_id=%s""",
        (text_id,),
    )
    old_ids = [c["id"] for c in old]
    db.execute("UPDATE text_chapters SET idx=-idx-1 WHERE id=ANY(%s)", (old_ids,))

    tokens = []
    offsets = [0]
    for c in old:
        c["token_base"] = len(tokens)
        c["base"] = offsets[-1]
        rows = db.execute(
            """SELECT idx,surface,is_word,is_oov,sentence_idx FROM text_tokens
            WHERE chapter_id=%s ORDER BY idx""",
            (c["id"],),
        ).fetchall()
        if "".join(t["surface"] for t in rows) != c["body"] or any(
            t["idx"] != i for i, t in enumerate(rows)
        ):
            raise ValueError("Token positions do not match the saved body")
        tokens.extend(rows)
        position = c["base"]
        for t in rows:
            position += len(t["surface"])
            offsets.append(position)
        c["hash"] = md5(c["body"].encode()).hexdigest()

    analyses = []
    for index, (start, end, title) in enumerate(chapters):
        body = text[start:end]
        uid = uuid4()
        left, right = bisect_left(offsets, start), bisect_left(offsets, end)
        if offsets[left] != start or offsets[right] != end:
            raise ValueError("A chapter heading falls inside a reader token")
        reader_tokens = tokens[left:right]
        words = [t for t in reader_tokens if t["is_word"]]
        db.execute(
            """INSERT INTO text_chapters(id,text_id,idx,title,body,token_count)
            VALUES (%s,%s,%s,%s,%s,%s)""",
            (uid, text_id, index, title, body, len(words)),
        )
        raw = tokenize(body)
        raw_start = {t.start: i for i, t in enumerate(raw)}
        raw_end = {t.end: i + 1 for i, t in enumerate(raw)}
        excluded = Counter(t.kind for t in raw if t.kind != "word")
        constructions, stutters, revisions, versions = [], [], [], set()
        new_hash = md5(body.encode()).hexdigest()
        for c in old:
            a, b = max(start, c["base"]), min(end, c["base"] + len(c["body"]))
            if a >= b:
                continue
            lo, hi = bisect_left(offsets, a), bisect_left(offsets, b)
            delta, shift = c["base"] - start, c["token_base"] - left
            # Source sentence numbers include line breaks and punctuation. The
            # display tokenizer inserts additional whitespace tokens with index 0.
            first = next(i for i in range(lo, hi) if offsets[i] - start in raw_start)
            sentence_delta = (
                raw[raw_start[offsets[first] - start]].sentence
                - tokens[first]["sentence_idx"]
            )
            db.execute(
                "INSERT INTO segments VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (
                    c["id"],
                    uid,
                    lo - c["token_base"],
                    hi - c["token_base"],
                    a - c["base"],
                    b - c["base"],
                    shift,
                    delta,
                    sentence_delta,
                    start,
                    c["hash"],
                    new_hash,
                ),
            )
            stats = c["stats"]
            if stats.get("syllable_merges") or stats.get("syllable_merge_originals"):
                raise ValueError(
                    "This part contains saved syllable merges that need remapping"
                )
            if (
                stats.get("stutters")
                and stats.get("stutter_text_hash")
                != sha256(c["body"].encode()).hexdigest()
            ):
                raise ValueError("Stutter annotations do not match this part")
            revisions.append(c["revision"])
            versions.add(c["parser_version"])
            for item in stats.get("constructions", []):
                new_start, new_end = item["start"] + delta, item["end"] + delta
                if 0 <= new_start < len(body):
                    if body[new_start:new_end] != item["surface"] or new_end > len(
                        body
                    ):
                        raise ValueError("A construction does not fit in its chapter")
                    token_start = raw_start[new_start]
                    constructions.append(
                        dict(
                            item,
                            start=new_start,
                            end=new_end,
                            token_start=token_start,
                            token_end=raw_end[new_end],
                            sentence=raw[token_start].sentence,
                        )
                    )
            for item in stats.get("stutters", []):
                new_start = item["start"] + delta
                if 0 <= new_start < len(body):
                    if not body.startswith(item["surface"], new_start):
                        raise ValueError("A stutter does not fit in its chapter")
                    stutters.append(
                        dict(
                            item,
                            start=new_start,
                            first=item["first"] + shift,
                            word=item["word"] + shift,
                        )
                    )
        if len(versions) != 1:
            raise ValueError("Cannot combine parts from different parser versions")
        for stutter in stutters:
            if stutter["status"] in ("auto", "confirmed"):
                size = stutter["word"] - stutter["first"]
                excluded["restart"] += size
                excluded["punctuation"] -= size // 2
        stats = dict(
            constructions=constructions,
            excluded=dict(excluded),
            input_warning=None,
            hindi_word_fraction=len(words) / (len(words) + excluded["foreign"]),
            source_words=len(words),
            unresolved_occurrences=sum(t["is_oov"] for t in words),
            unique_word_forms=len({normalize(t["surface"]) for t in words}),
            stutters=stutters,
            stutter_text_hash=sha256(body.encode()).hexdigest(),
        )
        analyses.append((uid, min(revisions), versions.pop(), stats))
    move_rows(db, text_id, old_ids)
    for uid, revision, version, stats in analyses:
        stats.update(
            db.execute(
                """SELECT count(*) candidate_occurrences,count(distinct lemma_id) unique_entries
            FROM hindi_occurrences WHERE chapter_id=%s""",
                (uid,),
            ).fetchone()
        )
        db.execute(
            """INSERT INTO hindi_chapter_analyses
            (chapter_id,revision,parser_version,source_words,unresolved_words,stats) VALUES (%s,%s,%s,%s,%s,%s)""",
            (
                uid,
                revision,
                version,
                stats["source_words"],
                stats["unresolved_occurrences"],
                Jsonb(stats),
            ),
        )
    db.execute("DELETE FROM text_chapters WHERE id=ANY(%s)", (old_ids,))
    db.execute(
        """UPDATE hindi_imported_books SET metadata=jsonb_set(metadata,'{chapter_offsets}',%s)
        WHERE text_id=%s""",
        (Jsonb([[ch.start, ch.end] for ch in chapters]), text_id),
    )
    print(f"{book['title']} ({len(old)} parts to {len(chapters)} chapters)", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply", action="store_true", help="Commit the verified regrouping"
    )
    args = parser.parse_args()
    url = os.environ["DATABASE_URL"]
    if urlparse(url).hostname not in ("localhost", "127.0.0.1", "::1"):
        raise SystemExit("This tool only repairs a local database.")
    with connect(url, row_factory=dict_row) as db:
        db.execute("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
        db.execute("""CREATE TEMP TABLE segments (src uuid,dst uuid,lo int,hi int,first_char int,
            last_char int,tokens int,chars int,sentences int,chapter_start int,old_hash text,new_hash text)""")
        db.execute(
            "CREATE TEMP TABLE progress_anchors (user_id uuid,token_id uuid NOT NULL)"
        )
        books = db.execute(
            """WITH sources AS (
            SELECT text_id,content_hash,metadata->>'title' source_title FROM hindi_imported_books
        ), copies AS (
            SELECT c.text_id,s.content_hash,s.source_title FROM official_text_copies c
            JOIN sources s ON s.text_id=c.source_text_id
        ) SELECT t.id,t.title,s.* FROM (SELECT * FROM sources UNION ALL SELECT * FROM copies) s
        JOIN texts t ON t.id=s.text_id WHERE lower(s.source_title)=ANY(%s)
        ORDER BY s.source_title,t.id FOR UPDATE OF t""",
            (list(CHAPTER_COUNTS),),
        ).fetchall()
        for book in books:
            repair(db, book)
        db.execute("SET CONSTRAINTS ALL IMMEDIATE")
        if not args.apply:
            db.rollback()
            print("Dry run complete. Changes rolled back.")


if __name__ == "__main__":
    main()
