"""HindiDB's all-candidate parser, backed by Parhiba's editable dictionary."""

from __future__ import annotations

import os
import re
from collections import defaultdict
from functools import lru_cache
from threading import RLock
from typing import Any

from app.numbers import number_forms
from app.romanize import to_roman
from app.schemas import LemmaCandidate, Token
from hindidb.lexicon import Lexicon, lexical_id
from hindidb.parser import PARSER_VERSION, analyze

from .base import Pipeline, PipelineResult


@lru_cache(maxsize=100_000)
def _romanize(surface):
    return to_roman(surface, from_script="Deva", to_scheme="iso15919", language="hi")


class DatabaseLexicon:
    def __init__(self):
        self.revision = None
        self.lexicon = None
        self.ids = {}
        self.lock = RLock()

    def load(self):
        import psycopg

        url = os.environ.get("DATABASE_URL")
        if not url:
            raise RuntimeError("HindiDB requires DATABASE_URL pointing at the Parhiba dictionary")
        with self.lock, psycopg.connect(url) as conn:
            conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            state = conn.execute(
                "SELECT revision FROM hindi_dictionary_state WHERE id = 1"
            ).fetchone()
            if not state:
                raise RuntimeError("Import the HindiDB dictionary before processing Hindi text")
            revision = state[0]
            if revision != self.revision:
                entries = []
                ids = {}
                rows = conn.execute("""
                    SELECT l.id, l.headword, l.pos, h.entry,
                      COALESCE((SELECT jsonb_agg(f.surface ORDER BY f.surface)
                        FROM lemma_forms f WHERE f.lemma_id = l.id
                        AND f.quarantined_at IS NULL), '[]'::jsonb)
                    FROM hindi_entries h JOIN lemmas l ON l.id = h.lemma_id
                    WHERE l.language = 'hi' ORDER BY h.external_id
                """).fetchall()
                for uid, headword, pos, entry, forms in rows:
                    entry = {**entry, "lemma": headword, "pos": pos, "forms": forms}
                    key = lexical_id(headword, pos)
                    if key in ids:
                        raise RuntimeError(f"Duplicate HindiDB identity: {headword}/{pos}")
                    ids[key] = str(uid)
                    entries.append(entry)
                if not entries:
                    raise RuntimeError("The HindiDB dictionary is empty")
                # Group metadata is already preserved on each entry. Reconstruct
                # live groups so edited/deleted POS uses cannot leave dangling IDs.
                groups = defaultdict(list)
                for entry in entries:
                    if entry.get("group_id"):
                        groups[entry["group_id"]].append(entry)

                def member_ids(members):
                    live = [lexical_id(e["lemma"], e["pos"]) for e in members]
                    ordered = [
                        use["id"] for use in members[0].get("group_uses", []) if use["id"] in live
                    ]
                    return list(dict.fromkeys(ordered + live))

                document = {
                    "entries": entries,
                    "entry_groups": [
                        {
                            "id": gid,
                            "lemma": members[0]["lemma"],
                            "primary": members[0].get("group_primary"),
                            "members": member_ids(members),
                        }
                        for gid, members in groups.items()
                        if len(members) > 1 and len({e["lemma"] for e in members}) == 1
                    ],
                }
                self.lexicon = Lexicon(documents=[document])
                self.ids = ids
                self.revision = revision
            return self.lexicon, dict(self.ids), revision


class HindiDBPipeline(Pipeline):
    pipeline_id = "hindidb-hi"

    def __init__(self, provider=None):
        self.provider = provider or DatabaseLexicon()

    def process(self, text: str) -> PipelineResult:
        lexicon, ids, revision = self.provider.load()
        analysis = analyze(text, lexicon)
        tokens = []
        source_to_output = {}
        cursor = 0
        number_spans = {m.start(): m for m in re.finditer(r"[+−-]?\d+(?:\.\d+)?%?", text)}
        for index, source in enumerate(analysis["tokens"]):
            if source["start"] < cursor:
                source_to_output[index] = len(tokens) - 1
                continue
            if source["start"] > cursor:
                tokens.append(
                    Token(idx=len(tokens), surface=text[cursor : source["start"]], is_word=False)
                )
            source_to_output[index] = len(tokens)
            numeric = number_spans.get(source["start"])
            if numeric and source["kind"] in ("number", "punctuation", "symbol"):
                reading = number_forms(numeric.group().removesuffix("%"))
                if reading and numeric.group().endswith("%"):
                    reading.hi.spelled += " प्रतिशत"
                    reading.hi.romanized += " " + _romanize("प्रतिशत")
                    reading.digits_latin += "%"
                    reading.digits_deva += "%"
                    reading.digits_orya += "%"
                tokens.append(
                    Token(
                        idx=len(tokens),
                        surface=numeric.group(),
                        is_word=False,
                        sentence_idx=source["sentence"],
                        number_forms=reading,
                    )
                )
                cursor = numeric.end()
                continue
            tokens.append(
                Token(
                    idx=len(tokens),
                    surface=source["surface"],
                    is_word=source["kind"] == "word",
                    sentence_idx=source["sentence"],
                    is_oov=source["kind"] == "word",
                    romanization=_romanize(source["surface"]) if source["kind"] == "word" else None,
                    number_forms=number_forms(source["surface"])
                    if source["kind"] == "number"
                    else None,
                )
            )
            cursor = source["end"]
        if cursor < len(text):
            tokens.append(Token(idx=len(tokens), surface=text[cursor:], is_word=False))
        occurrences = []
        for occurrence in analysis["occurrences"]:
            entry = lexicon.entries[occurrence["entry_id"]]
            start = source_to_output[occurrence["token_start"]]
            end = source_to_output[occurrence["token_end"] - 1] + 1
            uid = ids[occurrence["entry_id"]]
            occurrences.append(
                {
                    "start_idx": start,
                    "end_idx": end,
                    "lemma_id": uid,
                    "source_start": occurrence["start"],
                    "source_end": occurrence["end"],
                    "rules": occurrence["rules"],
                }
            )
            for token in tokens[start:end]:
                if token.is_word:
                    token.is_oov = False
            # Compounds are selectable at their first word; their exact spans
            # are stored independently and never counted as extra physical words.
            # Matching provenance belongs to the stored occurrence, not the
            # reader's grammatical form chips.
            features = {}
            if occurrence["compound"]:
                features["Compound"] = "Yes"
            tokens[start].candidates.append(
                LemmaCandidate(
                    lemma=entry["lemma"],
                    pos=entry["pos"],
                    score=1,
                    features=features,
                    dictionary_id=uid,
                )
            )
        for token in tokens:
            token.is_ambiguous = len(token.candidates) > 1
        payload: dict[str, Any] = {
            "revision": revision,
            "parser_version": PARSER_VERSION,
            "lexicon_fingerprint": analysis["lexicon_fingerprint"],
            "stats": analysis["stats"],
            "occurrences": occurrences,
            "constructions": analysis["constructions"],
        }
        return PipelineResult(self.pipeline_id, tokens, hindi_analysis=payload)


def build_hindidb_pipeline():
    return HindiDBPipeline()
