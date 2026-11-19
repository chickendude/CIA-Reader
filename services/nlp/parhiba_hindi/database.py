"""Load a consistent snapshot of Parhiba's Hindi dictionary."""

import os
from collections import defaultdict
from threading import RLock

from hindidb.lexicon import Lexicon, lexical_id


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
