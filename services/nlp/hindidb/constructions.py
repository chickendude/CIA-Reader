"""Reviewed vocabulary policy for productive light-verb constructions.

Keep source entries/IDs available for audit and existing study history. These
combinations are grammatical constructions, not additional vocabulary targets.
Do not classify from suffixes alone: e.g. गोद लेना and गुज़र जाना stay lexical.
"""

# User-directed policy, 2026-10-14. These have the base verb's ordinary meaning
# plus completion, onset, or another productive light-verb contribution. Source
# definitions remain in the lexicon; entries with additional idiomatic senses
# (including निकल जाना, झुक जाना, फट जाना) are deliberately retained.
COMPOSITIONAL = frozenset({
    'खा लेना', 'कर देना', 'कर लेना', 'देख लेना', 'दे देना', 'ले लेना',
    'पढ़ लेना', 'लिख देना', 'त्याग देना', 'छोड़ देना', 'हँस देना',
    'जीत जाना', 'हँस पड़ना', 'मरवा डालना', 'टूट जाना', 'भूल जाना',
    'धो देना', 'भाग जाना', 'ढा देना', 'जाग जाना', 'हो जाना',
    'डर जाना', 'पा लेना', 'मार डालना',
})


def is_construction(entry):
    # A reviewed local override may document a distinct lexical meaning.
    role = entry.get('vocabulary_role')
    if role in {'lexical', 'construction'}:
        return role == 'construction'
    return entry['pos'] == 'VERB' and entry['lemma'] in COMPOSITIONAL
