"""Draft explicit phrase forms from a selected, existing verb entry.

No free phrase discovery or global negation replacement: the user supplies the
phrase and chooses its variable verb. Saving the draft makes it lexical.
"""

from .lexicon import lexical_id
from .morphology import forms
from .text import normalize, tokenize


def verb_forms(entry):
    verb = entry["lemma"]
    generated = forms({'lemma': verb, 'pos': entry['pos'], 'paradigm': entry.get('paradigm', 'invariant')})
    candidates = forms(entry)
    supported = set()
    for word in candidates:
        if len(tokenize(word)) != 1 or any(t.kind != 'word' for t in tokenize(word)):
            continue
        evidence = entry.get('form_evidence', {}).get(word, [])
        # A root-link alone may point to a related/derived word, not an inflected
        # verb. Do not multiply such imported links into an entire phrase family.
        if (word in generated or entry.get('review_status') == 'reviewed' or not evidence
                or any(record.get('kind') == 'conjugation' for record in evidence)):
            supported.add(word)
    return supported


def build(lexicon, phrase, verb, negative_variants=False):
    if not isinstance(phrase, str) or not isinstance(verb, str) or not isinstance(negative_variants, bool):
        raise ValueError('Supply a phrase, verb, and boolean negation option')
    phrase, verb = normalize(phrase.strip()), normalize(verb.strip())
    words = phrase.split()
    if len(words) < 2 or not verb or len(verb.split()) != 1 or words.count(verb) != 1:
        raise ValueError('The phrase must contain the selected verb exactly once as a whole word')
    if any(t.kind != 'word' for t in tokenize(phrase)):
        raise ValueError('Enter the phrase without punctuation')
    entry = next((lexicon.entries[key] for pos in ('VERB', 'AUX')
                  if (key := lexical_id(verb, pos)) in lexicon.entries), None)
    if entry is None:
        raise ValueError('Verb not found. Add its dictionary entry and forms first')
    index = words.index(verb)
    frames = [words]
    if negative_variants:
        if index == 0 or words[index - 1] not in {'न', 'नहीं'}:
            raise ValueError('The न / नहीं option requires न or नहीं immediately before the verb')
        alternate = words.copy()
        alternate[index - 1] = 'नहीं' if words[index - 1] == 'न' else 'न'
        frames.append(alternate)
    supported = verb_forms(entry)
    result = {}
    for frame in frames:
        for word in sorted(supported):
            value = frame.copy()
            value[index] = word
            result[' '.join(value)] = ['phrase:verb-substitution', 'phrase:verb-entry:' + entry['id']]
    return {'forms': dict(sorted(result.items())), 'verb_id': entry['id'], 'verb': verb,
            'phrase': ' '.join(words), 'negative_variants': negative_variants,
            'verb_source': entry.get('source', ''), 'verb_forms': sorted(supported)}
