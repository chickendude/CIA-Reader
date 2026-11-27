"""Verb forms for the phrase editor and for reading saved Hindi verb phrases."""

from .headwords import alternative_headwords
from .morphology import excluded_forms, forms
from .text import normalize, tokenize

NEGATION = ('न', 'नहीं')


def verb_frames(entry):
    if entry['pos'] in {'VERB', 'AUX'}:
        for headword in (entry['lemma'], *alternative_headwords(entry)):
            words = headword.split()
            if (len(words) >= 2 and words[-1].endswith('ना') and len(words[-1]) > 2
                    and not any(word in ('न', 'नहीं', 'ना', 'मत') for word in words)):
                yield ' '.join(words[:-1]), words[-1]


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


def phrase_verb_inflections(entries):
    needed = {verb for entry in entries for _, verb in verb_frames(entry)}
    inflections = {}
    for entry in entries:
        verb = entry['lemma']
        if verb in needed and entry['pos'] in {'VERB', 'AUX'}:
            supported = verb_forms(entry)
            stem = verb[:-2]
            if stem not in excluded_forms(entry):
                supported.add(stem)
            inflections.setdefault(verb, set()).update(supported)
    return inflections


def reading_forms(entry, inflections):
    result = forms(entry)
    frames = list(verb_frames(entry))
    if not frames:
        return result
    excluded = excluded_forms(entry)
    # A phrase can have a saved inflection even when the standalone verb is missing.
    saved = {}
    for surface in result:
        prefix, _, tail = surface.rpartition(' ')
        saved.setdefault(prefix, set()).add(tail)
    for prefix, verb in frames:
        # Removing the infinitive ending gives the bare verb used before a light verb.
        # This also works for a newly added phrase whose verb has no separate entry.
        tails = saved.get(prefix, set()) | inflections.get(verb, {verb[:-2]})
        for tail in tails:
            if tail in NEGATION:
                continue
            positive = f'{prefix} {tail}'
            if positive in excluded:
                continue
            rules = result.setdefault(positive, {'phrase:verb-inflection'})
            for marker in NEGATION:
                negative = f'{prefix} {marker} {tail}'
                if negative not in excluded:
                    result.setdefault(negative, rules | {'phrase:negation'})
    return result


def build(lexicon, phrase, verb, negative_variants=False):
    from .lexicon import lexical_id

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
