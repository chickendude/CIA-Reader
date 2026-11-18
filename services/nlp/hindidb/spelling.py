"""Directional spelling candidates, separate from Unicode normalization.

An observed spelling may omit nuktas from a supported dictionary form. It may
not add or move them. This does not merge lexical IDs or modify source text.
"""

from .text import normalize

NUKTA = '\u093c'
# Hindi consonants with established nukta letters. Other Devanagari extensions
# and other combining marks are deliberately outside this spelling rule.
NUKTA_BASES = frozenset('कखगजडढफ')
OMITTED_NUKTA = 'spelling:omitted-nukta'
AA_NOUN_PLURAL = 'spelling:aa-noun-plural'
AA_NOUN_E_GLIDE = 'spelling:aa-noun-e-glide'


def aa_e_spellings(lemma, form):
    """ए/ये reading alternatives after an उ/ऊ stem, retaining every nasal mark.

    Applies only to an established masculine independent-आ noun's ए form,
    e.g. धुँआ -> धुँए / धुँये. The latter spelling is attested in the user's
    book and https://www.awgp.org/en/literature/akhandjyoti/1971/July/v2.27.
    This neither moves nasalization nor enables unrestricted य insertion.
    """
    if lemma.endswith('आ'):
        stem = lemma[:-1]
        vowel_stem = stem[:-1] if stem.endswith(('ँ', 'ं')) else stem
        if vowel_stem.endswith(('ु', 'ू', 'उ', 'ऊ')) and form == stem + 'ए':
            return {form, stem + 'ये'}
    return {form}


def aa_plural_spellings(lemma, plural):
    """Reading variants of an already supported आ-noun direct plural.

    परीक्षाएँ may be printed परीक्षाएं, परीक्षायें or परीक्षायेँ. This
    is not Unicode normalization, nor permission to infer a noun's gender or
    plural from its citation ending alone. Callers must establish the plural.
    """
    if lemma.endswith(('ा', 'आ')) and plural == lemma + 'एँ':
        return {plural, lemma + 'एं', lemma + 'यें', lemma + 'येँ'}
    return {plural}


def nukta_key(word):
    """Lookup bucket only; never use as a normalized spelling or lexical ID."""
    return ''.join(c for i, c in enumerate(word)
                   if not (c == NUKTA and i and word[i - 1] in NUKTA_BASES))


def omitted_nukta_match(observed, dictionary_form):
    """Inputs are normalized; require at least one omitted, supported nukta."""
    if observed == dictionary_form:
        return False
    j = 0
    for i, c in enumerate(dictionary_form):
        if j < len(observed) and observed[j] == c:
            j += 1
        elif c == NUKTA and i and dictionary_form[i - 1] in NUKTA_BASES:
            continue
        else:
            return False
    return j == len(observed)


def supported_spelling(observed, dictionary_forms):
    observed = normalize(observed.strip())
    return (not observed or observed in dictionary_forms or
            any(omitted_nukta_match(observed, form) for form in dictionary_forms))
