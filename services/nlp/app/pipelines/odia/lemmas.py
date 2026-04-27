"""Odia lemma table for the custom pipeline (T-2.3a).

At MVP this is a tiny hand-curated seed — just enough to exercise the
morphology rules in :mod:`app.pipelines.odia.morph` and drive the
golden-file tests in T-2.3b. The large-scale import from Odia WordNet
(ISI Kolkata) and OdiaNLP resources lands in T-3.1; at that point this
module stops being the source of truth and the Postgres ``lemmas``
table takes over.

The seed is a data file (``data/seed_lemmas.json``) rather than a
Python literal so T-2.3b golden-file contributors can extend it
without needing a code review round-trip on pure data additions.
"""

from __future__ import annotations

import json
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


@dataclass(frozen=True, slots=True)
class OdiaLemma:
    """A minimal lemma record for the Odia seed table.

    Richer fields (frequency rank, translations, variant spellings)
    live on the Postgres ``lemmas`` table that T-3.1 will populate.
    Here we only track what the pipeline itself needs: the headword
    (for stem matching), UD POS (to constrain morphology rules), and
    an optional short gloss (surfaced by the stub-translation path
    before real dictionary entries attach).
    """

    headword: str
    pos: str
    gloss: str | None = None


class OdiaLemmaTable:
    """Lookup-only wrapper over a dict keyed by NFC-normalized headword."""

    def __init__(self, entries: dict[str, OdiaLemma]) -> None:
        self._entries = entries

    def lookup(self, surface: str) -> OdiaLemma | None:
        """Return the lemma for an NFC-normalized surface, or ``None``.

        Callers are expected to NFC-normalize upstream (the /process
        HTTP layer does this globally), but we re-normalize here
        defensively — a mis-normalized key in the table or the query
        shouldn't silently become a lookup miss.
        """
        return self._entries.get(unicodedata.normalize("NFC", surface))

    def __len__(self) -> int:
        return len(self._entries)

    def __contains__(self, surface: str) -> bool:
        return unicodedata.normalize("NFC", surface) in self._entries


_SEED_PATH = Path(__file__).parent / "data" / "seed_lemmas.json"


def load_seed_lemma_table(path: Path | None = None) -> OdiaLemmaTable:
    """Load the seed lemma table from a JSON file.

    The ``path`` argument is overridable so tests can load a tiny custom
    fixture instead of the shipped seed.
    """
    source = path if path is not None else _SEED_PATH
    raw = json.loads(source.read_text(encoding="utf-8"))
    entries: dict[str, OdiaLemma] = {}
    for headword, fields in raw.get("entries", {}).items():
        nfc = unicodedata.normalize("NFC", headword)
        entries[nfc] = OdiaLemma(
            headword=nfc,
            pos=fields["pos"],
            gloss=fields.get("gloss"),
        )
    return OdiaLemmaTable(entries)


@lru_cache(maxsize=1)
def default_lemma_table() -> OdiaLemmaTable:
    """Cached default lemma table used by :func:`build_odia_pipeline`."""
    return load_seed_lemma_table()


__all__ = [
    "OdiaLemma",
    "OdiaLemmaTable",
    "default_lemma_table",
    "load_seed_lemma_table",
]
