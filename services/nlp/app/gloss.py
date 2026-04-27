"""Morphology gloss formatter (T-2.4).

Converts UD-style feature dicts into the human-readable strings the
reader's word pop-up shows ("3sg fem present habitual of bolnā"). The
pop-up component (M5) is the only current consumer — it already knows
how to italicize the lemma, bold the features, etc., so the formatter
returns a plain string and leaves styling to the UI layer.

The templates are intentionally compact and LingQ-like: each feature
maps to a short abbreviation (``Sing`` → ``sg``, ``Pres`` → ``present``,
``3`` → ``3``). That's a stable, internationally-readable vocabulary
for the MVP's target audience (English-speaking learners of Hindi /
Marathi / Odia). When M6 / M14 add native-language gloss preferences,
the formatter grows a language-of-explanation argument; for now
English is the one output language so we don't build infrastructure
for a choice that doesn't exist yet.
"""

from __future__ import annotations

# Abbreviations for UD feature values. Missing keys fall back to the raw
# UD token, which is verbose but never wrong — better than silently
# dropping an unknown feature.

_PERSON: dict[str, str] = {"1": "1", "2": "2", "3": "3"}
_NUMBER: dict[str, str] = {"Sing": "sg", "Plur": "pl", "Dual": "du"}
_GENDER: dict[str, str] = {"Masc": "masc", "Fem": "fem", "Neut": "neut"}
_TENSE: dict[str, str] = {"Pres": "present", "Past": "past", "Fut": "future"}
_ASPECT: dict[str, str] = {
    "Prog": "progressive",
    "Perf": "perfect",
    "Hab": "habitual",
    "Imp": "imperfective",
}
_MOOD: dict[str, str] = {
    "Imp": "imperative",
    "Sub": "subjunctive",
    "Cnd": "conditional",
    "Ind": "indicative",
}
_VERB_FORM: dict[str, str] = {
    "Inf": "infinitive",
    "Part": "participle",
    "Conv": "converb",
    "Ger": "gerund",
    "Fin": "",  # finite verb — the tense/aspect/person already conveys this
}
_CASE: dict[str, str] = {
    "Nom": "nominative",
    "Acc": "accusative",
    "Gen": "genitive",
    "Dat": "dative",
    "Loc": "locative",
    "Abl": "ablative",
    "Ins": "instrumental",
    "Voc": "vocative",
}
_DEGREE: dict[str, str] = {"Cmp": "comparative", "Sup": "superlative", "Pos": ""}
_VOICE: dict[str, str] = {"Act": "active", "Pass": "passive"}


def _translate(value: str, table: dict[str, str]) -> str:
    return table.get(value, value)


def _verb_gloss(features: dict[str, str]) -> str:
    """Compose the slot order for verbs: person+number, gender, tense,
    aspect, mood, voice, verb-form.
    """
    parts: list[str] = []

    person = features.get("Person")
    number = features.get("Number")
    if person and number:
        # "3sg", "1pl" — canonical person+number compact form.
        parts.append(f"{_translate(person, _PERSON)}{_translate(number, _NUMBER)}")
    elif person:
        parts.append(_translate(person, _PERSON))
    elif number:
        parts.append(_translate(number, _NUMBER))

    if (gender := features.get("Gender")) is not None:
        parts.append(_translate(gender, _GENDER))
    if (tense := features.get("Tense")) is not None:
        parts.append(_translate(tense, _TENSE))
    if (aspect := features.get("Aspect")) is not None:
        parts.append(_translate(aspect, _ASPECT))
    if (mood := features.get("Mood")) is not None:
        parts.append(_translate(mood, _MOOD))
    if (voice := features.get("Voice")) is not None:
        parts.append(_translate(voice, _VOICE))
    if (vf := features.get("VerbForm")) is not None:
        translated = _translate(vf, _VERB_FORM)
        if translated:
            parts.append(translated)
    return " ".join(p for p in parts if p)


def _noun_gloss(features: dict[str, str]) -> str:
    parts: list[str] = []
    if (number := features.get("Number")) is not None:
        parts.append(_translate(number, _NUMBER))
    if (gender := features.get("Gender")) is not None:
        parts.append(_translate(gender, _GENDER))
    if (case := features.get("Case")) is not None:
        parts.append(_translate(case, _CASE))
    return " ".join(p for p in parts if p)


def _adj_gloss(features: dict[str, str]) -> str:
    parts: list[str] = []
    if (degree := features.get("Degree")) is not None:
        translated = _translate(degree, _DEGREE)
        if translated:
            parts.append(translated)
    if (number := features.get("Number")) is not None:
        parts.append(_translate(number, _NUMBER))
    if (gender := features.get("Gender")) is not None:
        parts.append(_translate(gender, _GENDER))
    if (case := features.get("Case")) is not None:
        parts.append(_translate(case, _CASE))
    return " ".join(p for p in parts if p)


_POS_LABEL: dict[str, str] = {
    "NOUN": "noun",
    "PROPN": "proper noun",
    "VERB": "verb",
    "ADJ": "adjective",
    "ADV": "adverb",
    "PRON": "pronoun",
    "DET": "determiner",
    "ADP": "postposition",
    "CCONJ": "conjunction",
    "SCONJ": "subordinator",
    "PART": "particle",
    "INTJ": "interjection",
    "NUM": "number",
    "X": "unknown word",
    "PUNCT": "punctuation",
    "SYM": "symbol",
}


def format_gloss(
    *,
    pos: str | None,
    features: dict[str, str] | None,
    lemma: str | None,
) -> str:
    """Return a short reader-facing gloss for a token.

    Examples:

    * VERB + ``{Person:3, Number:Sing, Gender:Fem, Tense:Pres,
      Aspect:Hab}`` + lemma ``bolnā`` → ``"3sg fem present habitual
      of bolnā"``.
    * NOUN + ``{Number:Plur, Case:Loc}`` + lemma ``ghar`` →
      ``"pl locative of ghar"``.
    * ADJ + ``{Degree:Cmp}`` + lemma ``baḍa`` → ``"comparative of baḍa"``.
    * PUNCT or empty-feature content word → ``"punctuation"`` /
      ``"noun"`` / ``"verb"`` — the POS label alone.
    * Everything missing → ``""`` (caller decides what to render).

    ``pos`` and ``lemma`` are optional so we degrade gracefully on
    malformed input (mid-pipeline test doubles, partial corrections).
    Production data always has both.
    """
    features = features or {}
    pos = pos or "X"

    if pos in {"PUNCT", "SYM"}:
        return _POS_LABEL.get(pos, pos.lower())

    if pos == "VERB":
        body = _verb_gloss(features)
    elif pos == "NOUN" or pos == "PROPN":
        body = _noun_gloss(features)
    elif pos == "ADJ":
        body = _adj_gloss(features)
    else:
        body = ""

    label = _POS_LABEL.get(pos, pos.lower())

    if not body:
        # No enriching features: fall back to "<pos> <lemma>" or just
        # the POS label if we don't have a lemma either.
        if lemma:
            return f"{label} {lemma}".strip()
        return label

    if lemma:
        return f"{body} of {lemma}"
    return body


__all__ = ["format_gloss"]
