"""Atomic Hindi reanalysis, retaining token identities at unchanged source spans."""

import json
from pathlib import Path
import subprocess
from uuid import uuid4
from psycopg.types.json import Jsonb
from app.ocr.align import OcrPage, assign_token_boxes
from app.schemas import BBox, LemmaCandidate


def apply_web_stutters(body, result, previous, entries=()):
    if not any(h in body for h in "-‐‑"):
        return
    analysis = result.hindi_analysis
    script = Path(__file__).resolve().parents[1] / "apps/web/scripts/hindi-stutters.mjs"
    payload = {"body": body, "previous": previous, "entries": entries, "stats": analysis["stats"],
               "tokens": [t.model_dump(include={"idx", "surface", "is_word", "is_oov", "is_ambiguous", "candidates"})
                          for t in result.tokens], "occurrences": analysis["occurrences"]}
    response = subprocess.run(["node", "--experimental-strip-types", str(script)],
                              input=json.dumps(payload), text=True, stdout=subprocess.PIPE, check=True)
    applied = json.loads(response.stdout)
    analysis["stats"] = applied["stats"]
    analysis["occurrences"] = applied["occurrences"]
    for change in applied["changed"]:
        token = result.tokens[change["idx"]]
        token.is_word = change["is_word"]
        token.is_oov = change["is_oov"]
        token.is_ambiguous = change["is_ambiguous"]
        token.candidates = [LemmaCandidate(**candidate) for candidate in change["candidates"]]


def persist_chapter(conn, chapter_id, body, result, *, preserve_phrase_spans=False):
    analysis = result.hindi_analysis
    if not analysis:
        raise ValueError("HindiDB analysis required")
    old = conn.execute(
        "SELECT id,surface,bbox FROM text_tokens WHERE chapter_id=%s ORDER BY idx",
        (chapter_id,),
    ).fetchall()
    if preserve_phrase_spans and [row[1] for row in old] != [t.surface for t in result.tokens]:
        raise ValueError("Token boundaries changed; a full chapter reprocess is required")
    identities, char_boxes, cursor = {}, [None] * len(body), 0
    for uid, surface, bbox in old:
        start = body.find(surface, cursor)
        if start < 0:
            if bbox:
                raise ValueError("Cannot align PDF boxes; chapter kept unchanged")
            continue
        cursor = start + len(surface)
        identities[start, cursor, surface] = uid
        if bbox:
            char_boxes[start:cursor] = [BBox(**bbox)] * len(surface)
    boxes = assign_token_boxes(result.tokens, OcrPage(body, char_boxes))
    with conn.transaction():
        conn.execute("SELECT id FROM text_chapters WHERE id=%s FOR UPDATE", (chapter_id,))
        previous = conn.execute("SELECT stats FROM hindi_chapter_analyses WHERE chapter_id=%s",
                                (chapter_id,)).fetchone()
        previous_stats = previous[0] if previous else {}
        merge_ids = [m["lemmaId"] for m in previous_stats.get("syllable_merges", [])]
        entries = [{"id": str(uid), "headword": word, "pos": pos} for uid, word, pos in
                   conn.execute("""SELECT l.id,l.headword,l.pos FROM lemmas l JOIN hindi_entries e ON e.lemma_id=l.id
                     WHERE l.id=ANY(%s::uuid[]) AND NOT coalesce(e.entry->'excluded_forms','[]') ? l.headword""",
                                (merge_ids,))] if merge_ids else []
        apply_web_stutters(body, result, previous_stats, entries)
        if preserve_phrase_spans and not analysis["stats"].get("stutters") and not (
            previous and previous[0].get("stutters")
        ):
            return None
        revision = conn.execute(
            "SELECT revision FROM hindi_dictionary_state WHERE id=1 FOR SHARE"
        ).fetchone()[0]
        if revision != analysis["revision"]:
            raise ValueError("Dictionary changed during processing; retry")
        conn.execute(
            "CREATE TEMP TABLE IF NOT EXISTS hindi_token_stage (LIKE text_tokens INCLUDING DEFAULTS) ON COMMIT DROP"
        )
        conn.execute("TRUNCATE hindi_token_stage")
        cursor = 0
        with conn.cursor().copy(
            "COPY hindi_token_stage(id,chapter_id,idx,surface,lemma_id,lemma_candidates,features,is_ambiguous,is_oov,is_word,sentence_idx,romanization,number_forms,bbox) FROM STDIN"
        ) as copy:
            for t, bbox in zip(result.tokens, boxes, strict=True):
                end = cursor + len(t.surface)
                uid = identities.get((cursor, end, t.surface), uuid4())
                cursor = end
                candidates = [
                    {"lemmaId": c.dictionary_id, "score": 1, "features": c.features}
                    for c in t.candidates
                ]
                copy.write_row(
                    (
                        uid,
                        chapter_id,
                        t.idx,
                        t.surface,
                        candidates[0]["lemmaId"] if candidates else None,
                        Jsonb(candidates),
                        Jsonb(candidates[0]["features"] if candidates else {}),
                        t.is_ambiguous,
                        t.is_oov,
                        t.is_word,
                        t.sentence_idx,
                        t.romanization,
                        Jsonb(t.number_forms.model_dump()) if t.number_forms else None,
                        Jsonb(bbox.model_dump()) if bbox else None,
                    )
                )
        assert cursor == len(body), "Tokenizer must preserve original source"
        conn.execute(
            "UPDATE text_tokens SET idx=-idx-1 WHERE chapter_id=%s", (chapter_id,)
        )
        conn.execute("""INSERT INTO text_tokens SELECT * FROM hindi_token_stage ON CONFLICT(id) DO UPDATE SET
            idx=EXCLUDED.idx,surface=EXCLUDED.surface,lemma_id=EXCLUDED.lemma_id,lemma_candidates=EXCLUDED.lemma_candidates,
            features=EXCLUDED.features,is_ambiguous=EXCLUDED.is_ambiguous,is_oov=EXCLUDED.is_oov,is_word=EXCLUDED.is_word,
            sentence_idx=EXCLUDED.sentence_idx,romanization=EXCLUDED.romanization,number_forms=EXCLUDED.number_forms,bbox=EXCLUDED.bbox""")
        conn.execute(
            "DELETE FROM text_tokens WHERE chapter_id=%s AND id NOT IN(SELECT id FROM hindi_token_stage)",
            (chapter_id,),
        )
        conn.execute("DELETE FROM hindi_occurrences WHERE chapter_id=%s", (chapter_id,))
        if not preserve_phrase_spans:
            conn.execute("DELETE FROM phrase_chapter_spans WHERE chapter_id=%s", (chapter_id,))
        with conn.cursor().copy(
            "COPY hindi_occurrences(chapter_id,start_idx,end_idx,lemma_id,source_start,source_end,rules) FROM STDIN"
        ) as copy:
            for o in analysis["occurrences"]:
                copy.write_row(
                    (
                        chapter_id,
                        o["start_idx"],
                        o["end_idx"],
                        o["lemma_id"],
                        o["source_start"],
                        o["source_end"],
                        Jsonb(o["rules"]),
                    )
                )
        stats = analysis["stats"]
        conn.execute(
            """INSERT INTO hindi_chapter_analyses(chapter_id,revision,parser_version,source_words,unresolved_words,stats)
            VALUES(%s,%s,%s,%s,%s,%s) ON CONFLICT(chapter_id) DO UPDATE SET revision=EXCLUDED.revision,
            parser_version=EXCLUDED.parser_version,source_words=EXCLUDED.source_words,unresolved_words=EXCLUDED.unresolved_words,stats=EXCLUDED.stats""",
            (
                chapter_id,
                revision,
                analysis["parser_version"],
                stats["source_words"],
                stats["unresolved_occurrences"],
                Jsonb({**stats, "constructions": analysis["constructions"]}),
            ),
        )
        conn.execute(
            "UPDATE text_chapters SET token_count=%s WHERE id=%s",
            (stats["source_words"], chapter_id),
        )
    return stats
