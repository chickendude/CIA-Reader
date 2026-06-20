#!/usr/bin/env python3
"""Generate the Yiddish loshn-koydesh lemma table.

Background
----------
Yiddish romanization (``app.romanize._hebrew_to_yivo``) is rule-based:
a longest-match letter mapping that is close to exact for the Germanic
and Slavic component of the vocabulary, which is spelled *phonetically*
with the vowel-bearing letters (אַ אָ ו י ע) written out. It cannot work
for the **loshn-koydesh** component — the Hebrew/Aramaic-origin words,
which keep their etymological Hebrew spelling and are written without
vowels. שלום spells out to "shlum" but is "sholem"; מחבר → "mkhbr" but
"mekhaber". Two related failures follow:

* **Romanization** — both the headword (מחבר → mekhaber) and its
  inflected forms (plural מחברים → mekhabrem) need their curated
  reading; the rule drops the vowels on both.
* **Lemmatization** — מחברים should resolve to the lemma מחבר. The
  affix rules in :mod:`app.pipelines.yiddish.morph` strip ־ים, but the
  remainder only resolves if מחבר is a *known* lemma to the analyzer.

English Wiktionary records all of this. Each entry carries a ``forms``
list with the inflection table: canonical native-script forms and a
parallel list of their romanizations (same order), e.g. for מחבר —
``מחבר``/``mekhaber``, ``plural מחברים``/``mekhabrem``,
``feminine מחברטע``/``mekhaberte``.

This script harvests that into a lemma table in the *same JSON schema as
``seed_lemmas.json``* (headword → {pos, romanization, forms}), which the
pipeline merges into its analyzer lemma table. The single mechanism then
fixes both problems: the analyzer resolves מחברים to lemma מחבר with the
Number=Plur feature, and reports the curated reading for the headword and
every inflected surface.

Detector (which entries to include)
-----------------------------------
A Yiddish entry is included iff BOTH:

1. **It is a Hebrew/Aramaic loan** — established by Wiktionary etymology
   naming Hebrew/Aramaic, or by the word's *consonantal skeleton* (or a
   hyphen/space-separated compound segment, after peeling one common
   Yiddish affix) matching a Hebrew or Aramaic Wiktionary headword. This
   is what catches the high-frequency loans with no etymology and no
   exotic letters: כלב ``kelev``, רב ``reb``, מלכה ``malke``.

2. **The rule romanizer is actually wrong** for the headword OR at least
   one inflected form (``norm(rule) != norm(curated)``). This keeps the
   table to words where we add value and, combined with the loan gate,
   leaves native words alone even where Wiktionary's reading reflects a
   different dialect (גייסט → ``gayst`` vs. standard-YIVO ``geyst``) or
   carries stress diacritics.

Inputs (all gitignored; fetch with apps/web/scripts/fetch-dictionary-sources.sh):
  - kaikki-yiddish/raw.jsonl   (headwords + curated forms/readings)
  - kaikki-hebrew/raw.jsonl    `fetch-dictionary-sources.sh loshn-koydesh-aids`
  - kaikki-aramaic/raw.jsonl   "

Output (committed):
  app/pipelines/yiddish/data/loshn_koydesh_lemmas.json
    seed_lemmas.json schema: {"entries": {<headword>: {pos, romanization, forms}}}

Usage:
  python scripts/build_loshn_koydesh.py            # default paths
  python scripts/build_loshn_koydesh.py --check    # fail if output is stale
"""

from __future__ import annotations

import argparse
import json
import sys
import unicodedata
from pathlib import Path

# Run from services/nlp with PYTHONPATH=.:../../packages/shared-types/python
from app.romanize import _hebrew_to_yivo

_NLP_ROOT = Path(__file__).resolve().parent.parent
_WEB_DATA = _NLP_ROOT.parent.parent / "apps" / "web" / "data" / "dictionaries"
_OUT_PATH = (
    _NLP_ROOT / "app" / "pipelines" / "yiddish" / "data" / "loshn_koydesh_lemmas.json"
)

# Wiktionary language codes for the loshn-koydesh source languages.
_HEBREW_ARAMAIC_CODES = frozenset({"he", "hbo", "arc", "tmr", "jpa", "syc", "sem-pro"})

# Kaikki/Wiktionary POS → UD-style tags (mirrors kaikki.ts POS_MAP).
_POS_MAP = {
    "noun": "NOUN",
    "verb": "VERB",
    "adj": "ADJ",
    "adv": "ADV",
    "pron": "PRON",
    "conj": "CCONJ",
    "prep": "ADP",
    "postp": "ADP",
    "intj": "INTJ",
    "num": "NUM",
    "particle": "PART",
    "det": "DET",
    "name": "PROPN",
    "proper_noun": "PROPN",
}

# A leading tag-word on a canonical form ("plural מחברים") → UD features.
# Diminutives are derivational (a distinct lemma), and "Synonym:" etc. are
# noise — both map to None so we skip linking them as inflected forms.
_TAGWORD_FEATURES: dict[str, dict[str, str] | None] = {
    "plural": {"Number": "Plur"},
    "singular": {"Number": "Sing"},
    "feminine": {"Gender": "Fem"},
    "masculine": {"Gender": "Masc"},
    "accusative": {"Case": "Acc"},
    "dative": {"Case": "Dat"},
    "diminutive": None,
}

_FINALS = {"ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ"}
_LIGATURES = {"װ": "וו", "ױ": "וי", "ײ": "יי"}
_MIN_SKEL = 3
_SUFFIXES = ("דיקייט", "קייט", "דיק", "לעך", "עכץ", "ניק", "ות", "ים", "עס", "ער", "ן", "ע", "ל")
_PREFIXES = ("פֿאַר", "אַנט", "צו", "גע", "בא", "בּ")


def skeleton(word: str) -> str:
    """Consonantal skeleton: NFD, keep only base Hebrew letters, fold finals
    and ligatures. A pointed Hebrew headword and an unpointed Yiddish loan
    converge here."""
    s = unicodedata.normalize("NFC", word or "")
    for lig, pair in _LIGATURES.items():
        s = s.replace(lig, pair)
    s = "".join(c for c in unicodedata.normalize("NFD", s) if "א" <= c <= "ת")
    return "".join(_FINALS.get(c, c) for c in s)


def _norm_roman(s: str) -> str:
    """Fold a romanization for rule-vs-curated comparison: lowercase, drop
    separators and combining stress marks (Wiktionary writes é/à/ó)."""
    s = unicodedata.normalize("NFC", s or "").strip().lower()
    for ch in "'’-` ":
        s = s.replace(ch, "")
    return "".join(c for c in unicodedata.normalize("NFD", s) if not unicodedata.combining(c))


def _clean_roman(s: str) -> str:
    """Stored reading: strip combining stress marks, NFC, trim. The reader's
    YIVO layer doesn't mark stress and only a handful of entries carry it."""
    s = "".join(c for c in unicodedata.normalize("NFD", s or "") if not unicodedata.combining(c))
    return unicodedata.normalize("NFC", s).strip()


def _iter_entries(path: Path):
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def load_hebrew_aramaic_skeletons(*paths: Path) -> set[str]:
    out: set[str] = set()
    for path in paths:
        for d in _iter_entries(path):
            word = d.get("word")
            if word:
                s = skeleton(word)
                if len(s) >= 2:
                    out.add(s)
    return out


def _etymology_is_hebrew(entry: dict) -> bool:
    text = entry.get("etymology_text") or ""
    if "Hebrew" in text or "Aramaic" in text:
        return True
    for tmpl in entry.get("etymology_templates", []) or []:
        for value in (tmpl.get("args") or {}).values():
            if value in _HEBREW_ARAMAIC_CODES:
                return True
    return False


def _segment_is_loan(segment: str, hebrew_skeletons: set[str]) -> bool:
    s = skeleton(segment)
    if len(s) >= _MIN_SKEL and s in hebrew_skeletons:
        return True
    for suffix in _SUFFIXES:
        if segment.endswith(suffix):
            stem = skeleton(segment[: len(segment) - len(suffix)])
            if len(stem) >= _MIN_SKEL and stem in hebrew_skeletons:
                return True
    for prefix in _PREFIXES:
        if segment.startswith(prefix):
            stem = skeleton(segment[len(prefix) :])
            if len(stem) >= _MIN_SKEL and stem in hebrew_skeletons:
                return True
    return False


def is_loshn_koydesh(entry: dict, hebrew_skeletons: set[str]) -> bool:
    if _etymology_is_hebrew(entry):
        return True
    word = unicodedata.normalize("NFC", entry.get("word") or "")
    for segment in word.replace("־", " ").replace("-", " ").split():
        if segment and _segment_is_loan(segment, hebrew_skeletons):
            return True
    return False


def _parse_canonical(form_str: str) -> tuple[str, dict[str, str] | None]:
    """Split a canonical form ("plural מחברים") into (surface, features).

    Returns (surface, None) when the leading tag-word is one we don't link
    (diminutive, unknown) so the caller can skip it. A form with no leading
    tag-word (the headword, or a plain variant) yields empty features.
    """
    parts = unicodedata.normalize("NFC", form_str).split()
    if not parts:
        return "", None
    first = parts[0]
    has_tagword = parts[0] and not any("א" <= ch <= "ת" for ch in first)
    if has_tagword:
        features = _TAGWORD_FEATURES.get(first.rstrip(":").lower(), None)
        if features is None:
            return "", None  # diminutive / unknown — don't link
        return " ".join(parts[1:]).strip(), dict(features)
    return form_str.strip(), {}


def build_entry(entry: dict) -> tuple[str, dict] | None:
    """Convert one loan Kaikki entry into a (headword, lemma-record) pair, or
    None when the rule romanizer is already right everywhere (nothing to add).

    The lemma record matches the seed_lemmas.json schema:
      {pos, romanization?, forms: {surface: {features, romanization?}}}
    """
    headword = unicodedata.normalize("NFC", entry.get("word") or "").strip()
    if not headword:
        return None
    pos = _POS_MAP.get((entry.get("pos") or "").lower(), "X")

    forms = entry.get("forms") or []
    canonical = [f["form"] for f in forms if "canonical" in (f.get("tags") or []) and f.get("form")]
    romans = [f["form"] for f in forms if "romanization" in (f.get("tags") or []) and f.get("form")]
    if not romans:
        return None

    headword_roman: str | None = romans[0]
    form_records: dict[str, dict] = {}

    # The inflection table is two parallel lists; trust the pairing only when
    # the counts line up (the dominant case). Otherwise keep just the headword.
    if canonical and len(canonical) == len(romans):
        for native, roman in zip(canonical, romans, strict=True):
            surface, features = _parse_canonical(native)
            if not surface:
                continue
            if surface == headword:
                headword_roman = roman
                continue
            form_records[surface] = {
                "features": features or {},
                "romanization": _clean_roman(roman),
            }

    # Include only if the rule romanizer is wrong somewhere — that's where the
    # table earns its keep (and, with the loan gate, where it's safe).
    def rule_wrong(surface: str, curated: str) -> bool:
        return _norm_roman(_hebrew_to_yivo(surface)) != _norm_roman(curated)

    headword_wrong = headword_roman is not None and rule_wrong(headword, headword_roman)
    forms_wrong = any(rule_wrong(s, r["romanization"]) for s, r in form_records.items())
    if not (headword_wrong or forms_wrong):
        return None

    record: dict = {"pos": pos}
    if headword_roman is not None:
        record["romanization"] = _clean_roman(headword_roman)
    if form_records:
        record["forms"] = form_records
    return headword, record


def build_entries(
    yiddish_path: Path, hebrew_path: Path, aramaic_path: Path
) -> dict[str, dict]:
    hebrew_skeletons = load_hebrew_aramaic_skeletons(hebrew_path, aramaic_path)
    print(f"[build] Hebrew/Aramaic skeleton set: {len(hebrew_skeletons)}", file=sys.stderr)

    entries: dict[str, dict] = {}
    loans = kept = form_count = collisions = 0
    for entry in _iter_entries(yiddish_path):
        if not is_loshn_koydesh(entry, hebrew_skeletons):
            continue
        loans += 1
        built = build_entry(entry)
        if built is None:
            continue
        headword, record = built
        if headword in entries:
            # Homograph across POS/senses (רב reb/rov): first wins, but merge
            # in any inflected forms the later entry contributes.
            collisions += 1
            entries[headword].setdefault("forms", {}).update(record.get("forms", {}))
            continue
        entries[headword] = record
        kept += 1
        form_count += len(record.get("forms", {}))

    print(
        f"[build] loan entries seen={loans} kept={kept} inflected-forms={form_count} "
        f"homograph-merges={collisions}",
        file=sys.stderr,
    )
    return dict(sorted(entries.items()))


def render(entries: dict[str, dict]) -> str:
    payload = {
        "__description__": (
            "Yiddish loshn-koydesh (Hebrew/Aramaic loan) lemma table. Generated by "
            "services/nlp/scripts/build_loshn_koydesh.py from English Wiktionary "
            "(Kaikki.org). Same schema as seed_lemmas.json; merged into the analyzer "
            "lemma table by build_yiddish_pipeline so inflected loans resolve to their "
            "lemma (מחברים → מחבר) and headwords + forms carry the curated YIVO reading "
            "the rule-based romanizer can't produce. Kept only for detected loans where "
            "the rule is wrong. Do not edit by hand — re-run the generator. Attribution: "
            "Wiktionary via Kaikki.org (CC-BY-SA-3.0)."
        ),
        "entries": entries,
    }
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--yiddish", type=Path, default=_WEB_DATA / "kaikki-yiddish" / "raw.jsonl")
    parser.add_argument("--hebrew", type=Path, default=_WEB_DATA / "kaikki-hebrew" / "raw.jsonl")
    parser.add_argument("--aramaic", type=Path, default=_WEB_DATA / "kaikki-aramaic" / "raw.jsonl")
    parser.add_argument("--out", type=Path, default=_OUT_PATH)
    parser.add_argument(
        "--check",
        action="store_true",
        help="exit non-zero if the committed file differs from a fresh build",
    )
    args = parser.parse_args()

    for path in (args.yiddish, args.hebrew, args.aramaic):
        if not path.exists():
            parser.error(
                f"missing input {path}\n"
                "fetch with: apps/web/scripts/fetch-dictionary-sources.sh kaikki-yiddish "
                "&& apps/web/scripts/fetch-dictionary-sources.sh loshn-koydesh-aids"
            )

    rendered = render(build_entries(args.yiddish, args.hebrew, args.aramaic))

    if args.check:
        current = args.out.read_text(encoding="utf-8") if args.out.exists() else ""
        if current != rendered:
            print(f"[check] {args.out} is stale — re-run build_loshn_koydesh.py", file=sys.stderr)
            return 1
        print(f"[check] {args.out} is up to date", file=sys.stderr)
        return 0

    args.out.write_text(rendered, encoding="utf-8")
    print(f"[build] wrote {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
