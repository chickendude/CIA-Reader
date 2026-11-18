"""Named alternative citations, distinct from inflected surface forms."""

from .text import normalize


def alternative_headwords(entry):
    values = entry.get('alternative_headwords', [])
    if not isinstance(values, list) or any(not isinstance(v, str) or not v.strip() for v in values):
        raise ValueError('Alternative headwords must be a list of nonempty strings')
    primary = normalize(entry['lemma'].strip())
    return list(dict.fromkeys(normalize(v.strip()) for v in values if normalize(v.strip()) != primary))
