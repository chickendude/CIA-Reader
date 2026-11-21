"""Reviewable grammatical slots; these do not add analyses to the parser.

Inventory references: https://en.wiktionary.org/wiki/Appendix:Hindi_verbs
and the imported Wiktionary declension/conjugation tags. Not every slot applies
to every lemma. Derivations and periphrastic auxiliary sequences are excluded.
"""

from copy import deepcopy

from .morphology import forms, inflectable_alternatives, verb_pattern_slots, uu_noun_pattern_slots, nasal_aa_noun_pattern_slots, aa_noun_pattern_slots, adjective_agreement_forms
from .text import normalize

VERSION = "hindi-form-slots-1"


def dictionary_source(lexicon, lemma, pos):
    """Keep imported evidence accessible even after a complete local override."""
    source = next((deepcopy(e) for e in lexicon.entries.values()
                   if e["lemma"] == lemma and e["pos"] == pos), {})
    for document in lexicon.documents:
        if not document.get("builder", "").startswith("wiktionary-foundation-"):
            continue
        foundation = next((e for e in document["entries"] if e["lemma"] == lemma and e["pos"] == pos), None)
        if foundation is None:
            continue
        source.setdefault("lemma", lemma)
        source.setdefault("pos", pos)
        source["forms"] = sorted(set(source.get("forms", [])) | set(foundation.get("forms", [])))
        evidence = source.setdefault("form_evidence", {})
        for word, records in foundation.get("form_evidence", {}).items():
            existing = evidence.setdefault(word, [])
            existing.extend(deepcopy(record) for record in records if record not in existing)
        source["dictionary_resource"] = foundation.get("dictionary_resource", {})
        source["dictionary_source"] = foundation["source"]
        definitions = source.setdefault("definitions", [])
        definitions.extend(deepcopy(d) for d in foundation.get("definitions", []) if d not in definitions)
    return source


def validate_saved(entry):
    inventory = entry.get("form_inventory")
    if inventory is None:
        return
    if not isinstance(inventory, dict) or inventory.get("version") != VERSION:
        raise ValueError("Unsupported form inventory version")
    if (normalize(inventory.get("lemma", "")), inventory.get("pos")) != (normalize(entry["lemma"]), entry["pos"]):
        raise ValueError("Form inventory belongs to a different dictionary entry")
    rows = inventory.get("slots")
    allowed = {s["id"] for s in slots(entry["pos"], entry.get("paradigm"))}
    if not isinstance(rows, list) or any(not isinstance(r, dict) for r in rows):
        raise ValueError("Invalid form inventory slots")
    ids = [r.get("id") for r in rows]
    if len(ids) != len(set(ids)) or set(ids) != allowed:
        raise ValueError("Form inventory must contain each grammatical slot exactly once")
    active = {normalize(f) for f in entry.get("forms", [])}
    for row in rows:
        candidates = row.get("forms")
        if not isinstance(candidates, list) or any(not isinstance(f, str) or not f.strip() for f in candidates):
            raise ValueError("Slot forms must be nonempty strings")
        if row.get("applicability") not in {"applicable", "unknown", "not_applicable"} or (candidates and row["applicability"] != "applicable"):
            raise ValueError("Inconsistent slot applicability")
        if not isinstance(row.get("include"), bool):
            raise ValueError("Each form slot requires an inclusion choice")
        if row["include"] and (not candidates or not {normalize(f) for f in candidates} <= active):
            raise ValueError("Selected slot forms must be included in the entry's explicit forms")


def slots(pos, paradigm=None):
    result = []

    def add(key, label, *tags):
        result.append({"id": key, "label": label, "tags": list(tags)})

    def agreement(key, label, tags, cases=(None,)):
        for gender in ("masculine", "feminine"):
            for number in ("singular", "plural"):
                for case in cases:
                    features = [gender, number] + ([case] if case else [])
                    add("-".join([key, *features]), f"{label}: {', '.join(features)}", *tags, *features)

    if pos in {"NOUN", "PROPN"} and paradigm in {"noun_mf_aa_ii", "noun_mf_uu"}:
        agreement("nominal", "Noun", [], ("direct", "oblique", "vocative"))
    elif pos in {"NOUN", "PROPN", "NUM"}:
        for number in ("singular", "plural"):
            for case in ("direct", "oblique", "vocative"):
                add(f"{number}-{case}", f"{number.title()}, {case}", number, case)
    elif pos in {"ADJ", "DET", "ADP"}:
        agreement("agreement", "Agreement", [], ("direct", "oblique", "vocative"))
    elif pos == "PRON":
        # Personal pronouns have lexical person/number; मैं -> हम is a different
        # entry, not a plural we should invent for every pronoun.
        for case in ("direct", "oblique", "accusative", "dative", "ergative"):
            add(case, case.title(), case)
        agreement("possessive", "Possessive agreement (when lexicalized here)", ["possessive"], ("direct", "oblique"))
    elif pos in {"VERB", "AUX"}:
        for gender in ("masculine", "feminine"):
            for number in ("singular", "plural"):
                extra = ["direct"] if gender == "masculine" and number == "singular" else []
                add(f"infinitive-{gender}-{number}", f"Infinitive: {gender}, {number}", "infinitive", gender, number, *extra)
        add("infinitive-oblique", "Infinitive, oblique", "infinitive", "oblique")
        for aspect in ("habitual", "perfective"):
            for gender in ("masculine", "feminine"):
                for number in ("singular", "plural"):
                    cases = ("direct", "oblique") if (gender, number) == ("masculine", "singular") else (None,)
                    for case in cases:
                        features = [gender, number] + ([case] if case else [])
                        add("-".join([aspect, *features]), f"{aspect.title()} participle: {', '.join(features)}", aspect, *features)
        add("conjunctive", "Conjunctive participle (e.g. -कर / -के)", "conjunctive")
        agreement("counterfactual", "Counterfactual", ["counterfactual"])
        agreement("past", "Simple past (where applicable)", ["past", "indicative"])
        for mood, label, tags, genders in (
                ("present", "Simple present (where applicable)", ["present", "indicative"], (None,)),
                ("present-subjunctive", "Present subjunctive (where applicable)", ["present", "subjunctive"], (None,)),
                ("future-subjunctive", "Future subjunctive", ["future", "subjunctive"], (None,)),
                ("future", "Future indicative", ["future", "indicative"], ("masculine", "feminine"))):
            for person in ("first-person", "second-person", "third-person"):
                for number in ("singular", "plural"):
                    for gender in genders:
                        features = [person, number] + ([gender] if gender else [])
                        add("-".join([mood, *features]), f"{label}: {', '.join(features)}", *tags, *features)
        for tense in ("present", "future"):
            for address, tags in (("intimate", ["singular"]), ("familiar", ["plural"]), ("polite", ["plural", "formal"])):
                add(f"imperative-{tense}-{address}", f"Imperative: {tense}, {address}", "imperative", tense, "second-person", *tags)
    else:
        add("citation", "Invariant citation form", "canonical")
    return result


def tagged_match(slot, evidence):
    """Require all slot features, not merely an identical spelling somewhere."""
    if evidence.get("kind") not in {"inflection", "declension", "conjugation"} or not evidence.get("record_id"):
        return False
    tags = set(evidence.get("tags", []))
    if "indirect" in tags:
        tags.add("oblique")
    if slot["id"].endswith("-familiar") and "formal" in tags:
        return False
    return set(slot["tags"]).issubset(tags)


def slot_pattern_forms(entry, slot):
    """A flat set of generated spellings cannot validate a grammatical slot.

    None means this pattern has no slot-specific validation. In particular,
    'invariant' is the editor default (no generation), not evidence that a noun
    is indeclinable. Keep unknown classes unverified instead of guessing one.
    """
    expected = _headword_slot_forms(entry, slot, normalize(entry['lemma']))
    if expected is not None:
        for alias in inflectable_alternatives(entry):
            expected.update(_headword_slot_forms(entry, slot, alias) or ())
    return expected


def _headword_slot_forms(entry, slot, lemma):
    pattern = entry.get("paradigm", "invariant")
    if slot["id"] == "citation":
        return {lemma}
    tags = set(slot['tags'])
    if pattern.startswith('verb_') and entry['pos'] in {'VERB', 'AUX'}:
        return verb_pattern_slots(lemma, pattern).get(slot['id'])
    if pattern == 'adj_aa' and entry['pos'] in {'ADJ', 'DET', 'ADP', 'PRON'}:
        direct, masculine, feminine = adjective_agreement_forms(lemma)
        if 'feminine' in tags:
            return feminine
        if 'masculine' in tags:
            return direct if {'singular', 'direct'} <= tags else masculine
        return None
    if pattern == 'noun_mf_aa_ii' and entry['pos'] in {'NOUN', 'PROPN'}:
        feminine = 'feminine' in tags
        nominal = {**entry, 'lemma': lemma[:-1] + 'ी' if feminine else lemma,
                   'paradigm': 'noun_f_ii' if feminine else 'noun_m_aa'}
        case = next(c for c in ('direct', 'oblique', 'vocative') if c in tags)
        number = 'plural' if 'plural' in tags else 'singular'
        return _headword_slot_forms(nominal, {**slot, 'id': number + '-' + case}, nominal['lemma'])
    if entry["pos"] not in {"NOUN", "PROPN", "NUM"}:
        return None
    if pattern == 'noun_m_ind_aan':
        return nasal_aa_noun_pattern_slots(lemma).get(slot['id'])
    if pattern in {'noun_m_aa', 'noun_f_aa'}:
        return aa_noun_pattern_slots(lemma, pattern).get(slot['id'])
    if pattern in {'noun_m_uu', 'noun_f_uu', 'noun_mf_uu'} or (
            pattern in {'noun_m_consonant', 'noun_f_consonant'} and lemma.endswith(('ू', 'ऊ'))):
        return uu_noun_pattern_slots(lemma, pattern).get(slot['id'])
    if pattern in {"noun_m_consonant", "noun_f_consonant"}:
        values = [lemma, lemma, lemma, lemma if pattern == "noun_m_consonant" else lemma + "ें",
                  lemma + "ों", lemma + "ो"]
    elif pattern == "noun_m_ii":
        values = [lemma, lemma, lemma, lemma, lemma[:-1] + "ियों", lemma[:-1] + "ियो"]
    elif pattern == "noun_f_ii":
        endings = ["ियाँ", "ियों", "ियो"]
        values = [lemma, lemma, lemma, *(lemma[:-1] + ending for ending in endings)]
    else:
        return None
    by_slot = dict(zip([s["id"] for s in slots(entry["pos"])], values))
    return {normalize(by_slot[slot["id"]])}


def assess(slot, candidates, source, pattern_forms):
    known = {normalize(f) for f in source.get("forms", [])} | {normalize(source.get("lemma", ""))}
    evidence = source.get("form_evidence", {})
    checks = []
    for surface in candidates:
        word = normalize(surface)
        records = [e for e in evidence.get(word, []) if tagged_match(slot, e)]
        dictionary = bool(records) or (slot["id"] == "citation" and word == normalize(source.get("lemma", "")))
        pattern = word in pattern_forms if pattern_forms is not None else None
        checks.append({"form": surface, "status": "dictionary-slot" if dictionary else "unexpected" if pattern is False else "known-form" if word in known else "pattern-only" if pattern else "unverified",
                       "pattern_match": pattern, "evidence": records})
    return checks


def build(entry, source=None, proposed=None):
    source = source or {}
    # Never let explicit forms (especially the AI's own output) verify a rule.
    forms({"lemma": entry["lemma"], "pos": entry["pos"], "paradigm": entry.get("paradigm", "invariant")})
    template = slots(entry["pos"], entry.get("paradigm"))
    if proposed is not None:
        if not isinstance(proposed, list) or len(proposed) != len(template):
            raise ValueError("AI must return each grammatical slot exactly once")
        ids = [r.get("id") for r in proposed if isinstance(r, dict)]
        if len(ids) != len(set(ids)) or set(ids) != {r["id"] for r in template}:
            raise ValueError("AI returned duplicate or unknown grammatical slots")
    suggestions = {r["id"]: r for r in proposed or []}
    rows = []
    for slot in template:
        matched = sorted(word for word, records in source.get("form_evidence", {}).items()
                         if any(tagged_match(slot, e) for e in records))
        if slot["id"] == "citation" and source.get("lemma"):
            matched = [source["lemma"]]
        row = {**slot, "forms": matched, "applicability": "applicable" if matched else "unknown", "note": "", "include": False, "origin": "dictionary"}
        if slot["id"] in suggestions:
            suggestion = suggestions[slot["id"]]
            candidates = suggestion.get("forms")
            if (not isinstance(candidates, list) or len(candidates) > 20 or
                    any(not isinstance(f, str) or not f.strip() or len(f) > 120 for f in candidates)):
                raise ValueError("AI returned invalid forms")
            applicability = suggestion.get("applicability")
            if applicability not in {"applicable", "not_applicable", "unknown"} or (candidates and applicability != "applicable"):
                raise ValueError("AI returned inconsistent applicability")
            # Source-attested alternatives survive an AI omission or abstention.
            row.update(origin="ai", forms=list(dict.fromkeys(matched + [normalize(f.strip()) for f in candidates])),
                       applicability="applicable" if matched else applicability, note=str(suggestion.get("note", ""))[:1000])
        expected = slot_pattern_forms(entry, slot)
        row["checks"] = assess(slot, row["forms"], source, expected)
        if proposed is not None:
            # Keep unsupported AI conflicts as review evidence, rather than
            # presenting them as ordinary editable draft forms. Never remove a
            # dictionary-supported alternative just because a rule disagrees.
            withheld = []
            for check in row["checks"]:
                word = normalize(check["form"])
                nasal_vocative = (entry["pos"] in {"NOUN", "PROPN", "NUM"}
                                 and {'plural', 'vocative'} <= set(slot['tags'])
                                 and word.endswith(("ों", "ोँ"))
                                 and word != normalize(entry["lemma"]))
                if check["status"] != "dictionary-slot" and (check["pattern_match"] is False or nasal_vocative):
                    withheld.append({**check, "reason": "Plural vocative uses a non-nasal ending; this resembles plural oblique."
                                     if nasal_vocative else "Conflicts with the selected inflection pattern."})
            if withheld:
                row["withheld_forms"] = withheld
                rejected = {check["form"] for check in withheld}
                row["forms"] = [word for word in row["forms"] if word not in rejected]
                # Only an explicitly selected rule may supply a replacement.
                # An unassigned class abstains rather than guessing a paradigm.
                if not row["forms"] and expected is not None:
                    row["forms"] = sorted(expected)
                    row["pattern_fallback"] = True
                row["applicability"] = "applicable" if row["forms"] else "unknown"
                row["checks"] = assess(slot, row["forms"], source, expected)
        rows.append(row)
    return {"version": VERSION, "lemma": entry["lemma"], "pos": entry["pos"], "paradigm": entry.get("paradigm", "invariant"), "slots": rows}
