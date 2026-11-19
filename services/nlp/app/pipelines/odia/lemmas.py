"""Look up Odia headwords in the bundled seed dictionary. Loading the entries from JSON lets
contributors add vocabulary without editing Python."""

from __future__ import annotations

import json
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


@dataclass(frozen=True, slots=True)
class OdiaLemma:
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
