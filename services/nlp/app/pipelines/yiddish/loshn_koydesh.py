"""Generated loshn-koydesh lemma table for the Yiddish pipeline.

Hebrew/Aramaic-origin Yiddish words keep their etymological Hebrew
spelling and are written without vowels, so the rule-based YIVO
romanizer (:func:`app.romanize._hebrew_to_yivo`) can't read them
(שלום → "shlum" not "sholem", מחבר → "mkhbr" not "mekhaber"), and the
affix rules can't resolve their inflections to a lemma the seed knows
(מחברים → מחבר). Both facts are lexical, not derivable from spelling.

This module loads a generated lemma table — same schema as
``seed_lemmas.json`` — that supplies, for each detected loan, the
curated YIVO reading of the headword and its inflected forms plus the
form → lemma linkage. :func:`.build_yiddish_pipeline` merges it into the
analyzer's lemma table, so a single mechanism (:func:`app.pipelines.
yiddish.morph.analyze`) then resolves מחברים to lemma מחבר with
Number=Plur and reports the reading "mekhabrem".

The data file (``data/loshn_koydesh_lemmas.json``) is generated, not
hand-edited: ``scripts/build_loshn_koydesh.py`` harvests it from English
Wiktionary (Kaikki.org), kept only for loans where the rule romanizer is
wrong. Re-run that script to refresh it; a per-word curator fix belongs
on the Postgres lemma, not here.
"""

from __future__ import annotations

from pathlib import Path

from .lemmas import YiddishLemma, load_lemma_entries

_DATA_PATH = Path(__file__).parent / "data" / "loshn_koydesh_lemmas.json"


def loshn_koydesh_path() -> Path:
    """Path to the committed loshn-koydesh lemma JSON."""
    return _DATA_PATH


def load_loshn_koydesh_entries(path: Path | None = None) -> list[YiddishLemma]:
    """Load the loshn-koydesh lemmas. ``path`` is overridable for tests."""
    return load_lemma_entries(path if path is not None else _DATA_PATH)


__all__ = ["load_loshn_koydesh_entries", "loshn_koydesh_path"]
