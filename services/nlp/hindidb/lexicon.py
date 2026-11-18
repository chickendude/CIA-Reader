import hashlib
import json
from pathlib import Path

from .morphology import forms, excluded_forms
from .text import normalize, tokenize
from .spelling import nukta_key, omitted_nukta_match, OMITTED_NUKTA
from .entry_groups import apply_groups
from .headwords import alternative_headwords

SEED = Path(__file__).parent / "data" / "seed.json"
VALID_POS = {"NOUN", "VERB", "ADJ", "ADV", "PRON", "ADP", "PART", "CCONJ",
             "SCONJ", "DET", "NUM", "PROPN", "INTJ", "AUX", "VBASE", "ONOM"}


def lexical_id(lemma: str, pos: str) -> str:
    value = "hi\0" + normalize(lemma.strip()) + "\0" + pos
    return "hi_" + hashlib.sha256(value.encode()).hexdigest()[:24]


class Lexicon:
    def __init__(self, paths=None, *, documents=None):
        self.entries = {}
        self.trie = {}
        self.spelling_tokens = {}
        self.documents = []
        if documents is None:
            documents = [json.loads(Path(path).read_text(encoding="utf-8"))
                         for path in ([SEED] if paths is None else paths)]
        for document in documents:
            self.documents.append(document)
            for raw in document["entries"]:
                entry = dict(raw)
                entry["lemma"] = normalize(entry["lemma"].strip())
                if not entry["lemma"] or entry["pos"] not in VALID_POS:
                    raise ValueError(f"Invalid lexical entry: {entry}")
                entry.setdefault("source", document.get("source", "unspecified"))
                entry.setdefault("review_status", "provisional")
                entry["id"] = lexical_id(entry["lemma"], entry["pos"])
                if 'alternative_headwords' in entry:
                    entry['alternative_headwords'] = alternative_headwords(entry)
                # Additional files are complete, explicit overrides of matching entries.
                self.entries[entry["id"]] = entry
            for key in document.get('deleted_entries', []):
                self.entries.pop(key, None)
        apply_groups(self)
        for entry in self.entries.values():
            for form, rules in forms(entry).items():
                words = tokenize(form)
                if not words or any(t.kind not in {"word", "foreign"} and t.surface not in {"-", "–"} for t in words):
                    raise ValueError(f"Unsupported lexical form: {form}")
                node = self.trie
                for token in words:
                    node = node.setdefault(token.normalized, {})
                    folded = nukta_key(token.normalized)
                    if folded != token.normalized:
                        self.spelling_tokens.setdefault(folded, set()).add(token.normalized)
                node.setdefault(None, {})[entry["id"]] = sorted(rules)
        # Cache the hash prefix so a small local override need not serialize the
        # entire imported dictionary again. Bytes match the original JSON hash.
        self._document_hash = hashlib.sha256(b"[")
        for index, document in enumerate(self.documents):
            if index:
                self._document_hash.update(b", ")
            self._document_hash.update(json.dumps(document, ensure_ascii=False, sort_keys=True).encode())
        self._finish_fingerprint()

    def _finish_fingerprint(self):
        digest = self._document_hash.copy()
        digest.update(b"]")
        self.fingerprint = digest.hexdigest()

    def extended(self, path):
        """Apply an override with copy-on-write trie paths; keep the base intact."""
        override = Lexicon([path])
        result = object.__new__(Lexicon)
        result.documents = self.documents + override.documents
        result.entries = {**self.entries, **override.entries}
        deleted = set(override.documents[0].get('deleted_entries', []))
        for key in deleted:
            result.entries.pop(key, None)
        apply_groups(result)
        result.trie = self.trie
        # Immutable sets shared by older lexicons must not be changed by edits.
        # Removed words may remain in this small lookup index; matching still
        # requires a live trie branch, so deleted forms cannot be resurrected.
        result.spelling_tokens = self.spelling_tokens.copy()
        for folded, words in override.spelling_tokens.items():
            result.spelling_tokens[folded] = self.spelling_tokens.get(folded, set()) | words
        copies = {}

        def writable(node):
            # Copy each shared branch only once for this entire override. The
            # root can contain tens of thousands of forms; copying it for every
            # changed form makes a small dictionary edit unnecessarily expensive.
            key = id(node)
            if key not in copies:
                updated = dict(node)
                copies[key] = (node, updated)
                copies[id(updated)] = (updated, updated)
            return copies[key][1]

        def replace(node, words, key, rules, depth=0):
            updated = writable(node)
            if depth == len(words):
                leaves = writable(updated.get(None, {}))
                if rules is None:
                    leaves.pop(key, None)
                else:
                    leaves[key] = sorted(rules)
                if leaves:
                    updated[None] = leaves
                else:
                    updated.pop(None, None)
            else:
                word = words[depth]
                branch = replace(updated.get(word, {}), words, key, rules, depth + 1)
                if branch:
                    updated[word] = branch
                else:
                    updated.pop(word, None)
            return updated

        # Combine equivalent normalized token paths exactly as __init__ does.
        def paths(entry):
            return {tuple(t.normalized for t in tokenize(form)): rules
                    for form, rules in forms(entry).items()} if entry else {}

        for key in override.entries.keys() | deleted:
            entry = override.entries.get(key)
            previous = paths(self.entries.get(key))
            changed = paths(entry)
            for words in previous.keys() | changed.keys():
                if previous.get(words) != changed.get(words):
                    result.trie = replace(result.trie, words, key, changed.get(words))
        result._document_hash = self._document_hash.copy()
        if self.documents:
            result._document_hash.update(b", ")
        result._document_hash.update(json.dumps(override.documents[0], ensure_ascii=False, sort_keys=True).encode())
        result._finish_fingerprint()
        return result

    def matches(self, text, tokens, start):
        states = [(self.trie, (), False)]
        for end in range(start, len(tokens)):
            token = tokens[end]
            if (token.kind != "word" and token.surface not in {"-", "–"}) or token.sentence != tokens[start].sentence:
                break
            if end > start:
                previous = tokens[end - 1]
                gap = text[previous.end:token.start]
                if gap and not gap.isspace():
                    break
                if not gap and previous.kind == token.kind == "word":
                    break
            spellings = [(token.normalized, False)] + [
                (word, True) for word in sorted(self.spelling_tokens.get(nukta_key(token.normalized), ()))
                if omitted_nukta_match(token.normalized, word)]
            following = []
            exact, alternatives = {}, {}
            for node, path, omitted in states:
                for spelling, changed in spellings:
                    child = node.get(spelling)
                    if child is None:
                        continue
                    matched_path = path + (spelling,)
                    inferred = omitted or changed
                    following.append((child, matched_path, inferred))
                    for entry_id, rules in child.get(None, {}).items():
                        evidence = set(rules)
                        if inferred:
                            evidence.update({OMITTED_NUKTA, 'spelling:matched-form:' + ' '.join(matched_path)})
                        (alternatives if inferred else exact).setdefault(entry_id, set()).update(evidence)
            states = following
            if not states:
                break
            # Full credit once per span and entry. A listed exact spelling is
            # stronger evidence than a rule-derived route to the same entry.
            for entry_id in sorted(exact.keys() | alternatives.keys()):
                entry = self.entries[entry_id]
                # A local exclusion must also block a spelling-rule fallback.
                if entry.get('excluded_forms') and normalize(' '.join(text[tokens[start].start:token.end].split())) in excluded_forms(entry):
                    continue
                yield end, entry, sorted(exact.get(entry_id, alternatives.get(entry_id)))
