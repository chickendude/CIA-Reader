"""Forward generation from explicitly assigned lexical paradigms.

No guessed stems: a surface can only match forms of an existing lexical entry.
These limited paradigms are developmental, not a complete Hindi grammar.
"""

import unicodedata

from .text import normalize
from .headwords import alternative_headwords
from .spelling import AA_NOUN_PLURAL, AA_NOUN_E_GLIDE, aa_plural_spellings, aa_e_spellings

PARADIGMS = {"invariant", "noun_m_aa", "noun_m_ind_aan", "noun_m_consonant", "noun_f_consonant",
             "noun_m_ii", "noun_f_ii", "noun_f_aa", "noun_mf_aa_ii", "noun_m_uu", "noun_f_uu", "noun_mf_uu",
             "adj_aa", "verb_consonant", "verb_aa", "verb_explicit"}


# Earlier editor versions assigned the final-आँ pattern to these final-आ
# spellings. Read those assignments safely without changing their written stems.
LEGACY_NASAL_AA_CITATIONS = frozenset({'धुँआ', 'धूँआ', 'कुँआ', 'कुंआ'})


def pattern_fits_ending(lemma, pattern):
    """Filter editor/AI choices; an ending does not establish noun gender."""
    lemma = normalize(lemma.strip())
    if pattern == 'invariant':
        return True
    if not lemma:
        return False
    if pattern == 'noun_m_ind_aan':
        return lemma.endswith(('आँ', 'आं'))
    if pattern in {'noun_m_aa', 'noun_f_aa'}:
        return lemma.endswith(('ा', 'आ'))
    if pattern in {'noun_mf_aa_ii', 'adj_aa'}:
        return lemma.endswith('ा')
    if pattern in {'noun_m_ii', 'noun_f_ii'}:
        return lemma.endswith('ी')
    if pattern in {'noun_m_uu', 'noun_f_uu', 'noun_mf_uu'}:
        return lemma.endswith(('ू', 'ऊ'))
    if pattern in {'noun_m_consonant', 'noun_f_consonant'}:
        return lemma[-1] not in 'अआइईउऊऋॠऌॡऍऎएऐऑऒओऔािीुूृॄॅॆेैॉॊोौंँ'
    if pattern.startswith('verb_'):
        try:
            verb_pattern_slots(lemma, pattern)
        except ValueError:
            return False
        return not (pattern == 'verb_consonant' and lemma[:-2].endswith(('ा', 'आ')))
    return False


def nasal_aa_noun_pattern_slots(lemma):
    """Independent आँ nouns: धुआँ/कुआँ -> धुएँ/कुएँ -> धुओं/कुओं.

    Both plural oblique and vocative retain nasalization in the referenced
    Wiktionary declension tables. Other nasal noun classes need their own rules.
    """
    lemma = normalize(lemma)
    if lemma in LEGACY_NASAL_AA_CITATIONS:
        return aa_noun_pattern_slots(lemma, 'noun_m_aa')
    if not lemma.endswith(('आँ', 'आं')):
        raise ValueError(f'{lemma}: noun_m_ind_aan requires final आँ or a listed spelling variant')
    stem = lemma[:-2]
    values = [{lemma}, {stem + 'एँ'}, {stem + 'एँ'},
              {stem + 'एँ'}, {stem + 'ओं'}, {stem + 'ओं'}]
    return dict(zip((f'{number}-{case}' for number in ('singular', 'plural')
                     for case in ('direct', 'oblique', 'vocative')), values))


def aa_noun_pattern_slots(lemma, paradigm):
    """Long आ nouns accept both ा and independent आ, using matching vowel signs.

    जुआ -> जुए/जुओं/जुओ; दुआ -> दुआएँ/दुआओं/दुआओ.
    References: https://en.wiktionary.org/wiki/जुआ and /wiki/दुआ.
    Preserve the entire written stem, including nasal marks: धुँआ -> धुँए.
    Canonical spellings such as धुआँ belong in separate forms, not a stem rewrite.
    """
    lemma = normalize(lemma)
    if not lemma.endswith(('ा', 'आ')):
        raise ValueError(f'{lemma}: {paradigm} requires final ा/आ')
    if paradigm == 'noun_m_aa':
        stem = lemma[:-1]
        e, on, o = ('ए', 'ओं', 'ओ') if lemma.endswith('आ') else ('े', 'ों', 'ो')
        e_forms = aa_e_spellings(lemma, stem + e)
        values = [{lemma}, e_forms, e_forms, e_forms, {stem + on}, {stem + o}]
    else:
        values = [{lemma}, {lemma}, {lemma}, aa_plural_spellings(lemma, lemma + 'एँ'),
                  {lemma + 'ओं'}, {lemma + 'ओ'}]
    return dict(zip((f'{number}-{case}' for number in ('singular', 'plural')
                     for case in ('direct', 'oblique', 'vocative')), values))


def uu_noun_pattern_slots(lemma, paradigm):
    """ऊ shortens before independent vowel endings: झाड़ुओं, बहुएँ.

    Tables: https://en.wiktionary.org/wiki/झाड़ू#Declension and
    https://en.wiktionary.org/wiki/बहू#Declension. Gender remains a lexical choice.
    """
    lemma = normalize(lemma)
    if not lemma.endswith(('ू', 'ऊ')):
        raise ValueError(f'{lemma}: {paradigm} requires final ऊ/ू')
    stem = lemma[:-1] + ('ु' if lemma.endswith('ू') else 'उ')
    genders = ('masculine', 'feminine') if paradigm == 'noun_mf_uu' else (
        'feminine' if paradigm in {'noun_f_uu', 'noun_f_consonant'} else 'masculine',)
    result = {}
    for gender in genders:
        for number in ('singular', 'plural'):
            for case in ('direct', 'oblique', 'vocative'):
                word = lemma
                if number == 'plural':
                    word = (lemma if gender == 'masculine' else stem + 'एँ') if case == 'direct' else stem + ('ओं' if case == 'oblique' else 'ओ')
                key = f'{number}-{case}'
                if paradigm == 'noun_mf_uu':
                    key = f'nominal-{gender}-' + key
                result[key] = {word}
    return result


def adjective_agreement_forms(lemma):
    """Regular आ adjectives, including आया participial spelling alternatives.

    अलसाया -> अलसाये/अलसाए, अलसायी/अलसाई follows the same
    आ + य vowel spelling as the perfective of an आ-stem verb. Restrict
    this to आया/ाया, not arbitrary य (नया) or nominal endings (माया).
    """
    lemma = normalize(lemma)
    if not lemma.endswith('ा'):
        raise ValueError(f'{lemma}: adj_aa requires final ा')
    masculine = {lemma[:-1] + 'े'}
    feminine = {lemma[:-1] + 'ी'}
    if lemma.endswith(('ाया', 'आया')):
        masculine.add(lemma[:-2] + 'ए')
        feminine.add(lemma[:-2] + 'ई')
    return {lemma}, masculine, feminine


def verb_pattern_slots(lemma, paradigm):
    """Single-word regular inflections, shared by parsing and slot checks.

    आ-stem spelling alternatives follow the Hindi conjugation tables for
    बुलाना and खाना: https://en.wiktionary.org/wiki/बुलाना#Conjugation
    Irregular verbs still require verb_explicit and dictionary evidence.
    """
    lemma = normalize(lemma)
    if not lemma.endswith('ना') or len(lemma) <= 2:
        raise ValueError(f'Verb citation form must have a stem and end in ना: {lemma}')
    stem = lemma[:-2]
    aa = stem.endswith(('ा', 'आ'))
    if paradigm == 'verb_aa' and not aa:
        raise ValueError(f'{lemma}: verb_aa requires an आ-ending stem')
    regular = paradigm in {'verb_consonant', 'verb_aa'}
    # Older dictionaries assigned verb_consonant to आ stems (e.g. पहुँचाना).
    # Interpret that legacy assignment safely without rewriting user records.
    if regular and not aa and not (unicodedata.category(stem[-1]) == 'Lo' and
                                   'DEVANAGARI LETTER' in unicodedata.name(stem[-1], '') and
                                   stem[-1] not in 'अआइईउऊऋॠऌॡऍऎएऐऑऒओऔ') and not stem.endswith('़'):
        raise ValueError(f'{lemma}: this vowel stem needs explicit irregular forms')
    result = {}

    def add(key, *endings):
        result[key] = {normalize(stem + ending) for ending in endings}

    for gender, number, ending in [('masculine', 'singular', 'ना'), ('masculine', 'plural', 'ने'),
                                    ('feminine', 'singular', 'नी'), ('feminine', 'plural', 'नीं')]:
        add(f'infinitive-{gender}-{number}', ending)
    add('infinitive-oblique', 'ने')
    add('conjunctive', 'कर', 'के')
    for aspect in ('habitual', 'perfective', 'counterfactual'):
        if aspect == 'perfective':
            if not regular:
                continue
            endings = [('या',), ('ये', 'ए'), ('यी', 'ई'), ('यीं', 'ईं')] if aa else [('ा',), ('े',), ('ी',), ('ीं',)]
        else:
            endings = [('ता',), ('ते',), ('ती',), ('तीं',)]
        for (gender, number), suffixes in zip([('masculine', 'singular'), ('masculine', 'plural'),
                                               ('feminine', 'singular'), ('feminine', 'plural')], endings):
            key = f'{aspect}-{gender}-{number}'
            if (gender, number) == ('masculine', 'singular') and aspect != 'counterfactual':
                add(key + '-direct', *suffixes)
                add(key + '-oblique', *endings[1])
            else:
                add(key, *suffixes)
    if not regular:
        return result
    singular = ('ये', 'ए') if aa else ('े',)
    plural = ('यें', 'एँ') if aa else ('ें',)
    familiar = ('ओ',) if aa else ('ो',)
    first = ('ऊँ',) if aa else ('ूँ',)
    for person in ('first-person', 'second-person', 'third-person'):
        for number in ('singular', 'plural'):
            endings = first if (person, number) == ('first-person', 'singular') else singular if number == 'singular' else plural
            if (person, number) == ('second-person', 'plural'):
                endings = familiar + plural  # तुम and आप are both valid analyses.
            add(f'future-subjunctive-{person}-{number}', *endings)
            for gender in ('masculine', 'feminine'):
                agreement = 'गी' if gender == 'feminine' else 'गा' if number == 'singular' else 'गे'
                add(f'future-{person}-{number}-{gender}', *(ending + agreement for ending in endings))
    add('imperative-present-intimate', '')
    add('imperative-present-familiar', *familiar)
    polite = ('इए', 'इये') if aa else ('िए', 'िये')
    add('imperative-present-polite', *polite)
    add('imperative-future-intimate', 'इयो' if aa else 'ियो')
    add('imperative-future-familiar', 'ना')
    add('imperative-future-polite', *(ending + 'गा' for ending in polite))
    return result


def excluded_forms(entry: dict) -> set[str]:
    values = entry.get('excluded_forms', [])
    if not isinstance(values, list) or any(not isinstance(word, str) or not word.strip() for word in values):
        raise ValueError('Excluded forms must be a list of nonempty strings')
    excluded = {normalize(' '.join(word.split())) for word in values}
    headwords = {normalize(entry['lemma']), *alternative_headwords(entry)}
    if excluded & headwords:
        raise ValueError('Restore the form before using it as a dictionary or alternative headword')
    return excluded


def forms(entry: dict) -> dict[str, set[str]]:
    excluded = excluded_forms(entry)
    lemma = normalize(entry["lemma"])
    paradigm = entry.get("paradigm", "invariant")
    if entry.get('pos') == 'VBASE' and paradigm != 'invariant':
        raise ValueError('Verbal bases do not generate inflections; use invariant and explicit spelling variants')
    if entry.get('pos') == 'ONOM' and paradigm != 'invariant':
        raise ValueError('Onomatopoeia uses invariant and explicit attested forms')
    if paradigm not in PARADIGMS:
        raise ValueError(f"Unknown paradigm: {paradigm}")
    result: dict[str, set[str]] = {}

    def add(word, evidence):
        result.setdefault(normalize(word), set()).add(evidence)

    add(lemma, "citation")
    for word in alternative_headwords(entry):
        add(word, 'alternative-headword')
    for word in entry.get("forms", []):
        add(word, "explicit-form")
        for evidence in entry.get("form_evidence", {}).get(normalize(word), []):
            add(word, "wiktionary:" + evidence["kind"])
    if paradigm == 'noun_m_ind_aan':
        for words in nasal_aa_noun_pattern_slots(lemma).values():
            for word in words:
                add(word, paradigm)
    elif paradigm in {'noun_m_aa', 'noun_f_aa'}:
        for slot, words in aa_noun_pattern_slots(lemma, paradigm).items():
            for word in words:
                # Reading variants receive their existing spelling provenance below.
                if word != lemma and (paradigm != 'noun_f_aa' or slot != 'plural-direct' or word == lemma + 'एँ'):
                    add(word, paradigm)
    elif paradigm == 'adj_aa':
        for words in adjective_agreement_forms(lemma):
            for word in words:
                add(word, paradigm)
    elif paradigm == 'noun_mf_aa_ii':
        if not lemma.endswith("ा"):
            raise ValueError(f"{lemma}: {paradigm} requires final ा")
        stem = lemma[:-1]
        endings = ["े", "ों", "ो", "ी", "ियाँ", "ियों", "ियो"]
        for suffix in endings:
            add(stem + suffix, paradigm)
    elif paradigm in {'noun_m_uu', 'noun_f_uu', 'noun_mf_uu'} or (
            paradigm in {'noun_m_consonant', 'noun_f_consonant'} and lemma.endswith(('ू', 'ऊ'))):
        # Interpret legacy consonant assignments safely; do not rewrite IDs or
        # explicit user forms when upgrading the generation rule.
        for words in uu_noun_pattern_slots(lemma, paradigm).values():
            for word in words:
                add(word, paradigm)
    elif paradigm in {"noun_m_consonant", "noun_f_consonant"}:
        for suffix in (["ों", "ो"] if paradigm == "noun_m_consonant" else ["ें", "ों", "ो"]):
            add(lemma + suffix, paradigm)
    elif paradigm in {"noun_m_ii", "noun_f_ii"}:
        if not lemma.endswith("ी"):
            raise ValueError(f"{lemma}: {paradigm} requires final ी")
        for suffix in (["ियों", "ियो"] if paradigm == "noun_m_ii" else ["ियाँ", "ियों", "ियो"]):
            add(lemma[:-1] + suffix, paradigm)
    elif paradigm.startswith("verb_"):
        generated = verb_pattern_slots(lemma, paradigm)
        add(lemma[:-2], "verb-stem")
        for slot, words in generated.items():
            rule = ('verb-perfective' if slot.startswith('perfective-') else
                    'verb-finite' if slot.startswith(('future-', 'imperative-')) else 'verb-common')
            for word in sorted(words):
                add(word, rule)
    canonical_plural = lemma + 'एँ'
    if paradigm == 'noun_m_aa' or (paradigm == 'noun_m_ind_aan' and lemma in LEGACY_NASAL_AA_CITATIONS):
        base = lemma[:-1] + 'ए'
        for variant in aa_e_spellings(lemma, base) - {base}:
            if variant in result:
                result[variant].discard(paradigm)
                result[variant].update({AA_NOUN_E_GLIDE, 'spelling:matched-form:' + base})
    if entry.get('pos') in {'NOUN', 'PROPN'} and canonical_plural in result:
        for variant in sorted(aa_plural_spellings(lemma, canonical_plural) - {canonical_plural}):
            # Explicitly listed spellings retain their own evidence. Derived
            # variants are marked as reading rules, never dictionary attestations.
            if variant not in result:
                result[variant] = {AA_NOUN_PLURAL, 'spelling:matched-form:' + canonical_plural}
    return {word: rules for word, rules in result.items() if word not in excluded}
