"""All-candidate analysis and deterministic frequency aggregation."""

from collections import Counter
import hashlib

from .lexicon import Lexicon
from .examples import add_example_spans
from .constructions import is_construction
from .text import NORMALIZATION_VERSION, context, tokenize

PARSER_VERSION = "0.4.2"


def analyze(text: str, lexicon: Lexicon | None = None) -> dict:
    lexicon = lexicon or Lexicon()
    tokens = tokenize(text)
    occurrences = []
    constructions = []
    covered = set()
    frequencies = {}
    # Context is stored once per sentence, avoiding quadratic work for long prose.
    contexts = {}
    for index, token in enumerate(tokens):
        if token.kind != "word":
            continue
        if token.sentence not in contexts:
            contexts[token.sentence] = context(text, tokens, index)
        for end, entry, evidence in lexicon.matches(text, tokens, index):
            occurrence = {"start": token.start, "end": tokens[end].end,
                          "token_start": index, "token_end": end + 1,
                          "surface": text[token.start:tokens[end].end],
                          "entry_id": entry["id"], "rules": evidence,
                          "sentence": token.sentence, "compound": end > index}
            if is_construction(entry):
                constructions.append({**occurrence, 'lemma': entry['lemma']})
                continue
            covered.update(range(index, end + 1))
            occurrences.append(occurrence)
            row = frequencies.setdefault(entry["id"], {
                "entry_id": entry["id"], "lemma": entry["lemma"], "pos": entry["pos"],
                "count": 0, "forms": {}, "example": contexts[token.sentence],
                "example_start": token.start, "source": entry["source"],
                "review_status": entry["review_status"],
                "definitions": entry.get("definitions", []),
                **{field: entry[field] for field in ('group_id', 'group_primary', 'group_uses') if field in entry},
            })
            row["count"] += 1
            row["forms"][occurrence["surface"]] = row["forms"].get(occurrence["surface"], 0) + 1
    for key, row in frequencies.items():
        entry = lexicon.entries[key]
        if 'alternative_headwords' in entry:
            hidden = set(entry.get('hidden_alternative_headwords', []))
            row['alternative_headwords'] = [word for word in entry['alternative_headwords'] if word not in hidden]
    unresolved = {}
    for index, token in enumerate(tokens):
        if token.kind == "word" and index not in covered:
            row = unresolved.setdefault(token.normalized, {
                "form": token.normalized, "count": 0, "example": contexts[token.sentence],
                "offsets": []})
            row["count"] += 1
            row["offsets"].append([token.start, token.end])
    kinds = Counter(t.kind for t in tokens)
    letter_words = kinds["word"] + kinds["foreign"]
    hindi_fraction = kinds["word"] / letter_words if letter_words else None
    return add_example_spans({
        "parser_version": PARSER_VERSION, "normalization_version": NORMALIZATION_VERSION,
        "lexicon_fingerprint": lexicon.fingerprint,
        "content_hash": hashlib.sha256(text.encode()).hexdigest(),
        "policy": "all-supported-lexical-candidates; lexical-compounds-and-components; grammatical-constructions-not-vocabulary; distinct-span-entry",
        "constructions": constructions,
        "tokens": [t.to_dict() for t in tokens], "occurrences": occurrences,
        "frequencies": sorted(frequencies.values(), key=lambda r: (-r["count"], r["lemma"], r["pos"])),
        "unresolved": sorted(unresolved.values(), key=lambda r: (-r["count"], r["form"])),
        "stats": {"source_words": kinds["word"], "candidate_occurrences": len(occurrences),
                  "unique_word_forms": len({t.normalized for t in tokens if t.kind == 'word'}),
                  "unresolved_occurrences": sum(r["count"] for r in unresolved.values()),
                  "unique_entries": len(frequencies),
                  "hindi_word_fraction": hindi_fraction,
                  "input_warning": ("Little or no Devanagari text; check extraction or legacy font encoding"
                                    if hindi_fraction is None or hindi_fraction < 0.5 else None),
                  "excluded": {k: v for k, v in kinds.items() if k != "word"}},
    })
