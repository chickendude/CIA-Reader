/**
 * Hindi seed dictionary (T-3.1).
 *
 * Small embedded set of ~20 public-domain Hindi lemmas with English
 * glosses, bundled so the import runner has at least one working,
 * testable importer on day one. Large-scale imports (Hindi WordNet /
 * Shabdanjali / Dbnary) land in follow-up PRs where each source's
 * license + fetch pipeline is resolved.
 *
 * The point of *this* file is to prove out the upsert / curator-lock
 * machinery against real data shapes — not to ship a complete Hindi
 * dictionary. The entries here were chosen to be unambiguous
 * dictionary forms (no inflections), common vocabulary, and
 * uncontroversially in the public domain as individual lexical items.
 */
import type { DictionaryImportSource, ImportEntry } from '../types.js';

const ENTRIES: ImportEntry[] = [
  {
    sourceId: 'hi-seed:pani',
    headword: 'पानी',
    pos: 'NOUN',
    script: 'Deva',
    glossDefault: 'water',
    frequencyRank: 120,
    translations: [{ sourceId: 'hi-seed:pani:en:1', body: 'water' }],
  },
  {
    sourceId: 'hi-seed:ghar',
    headword: 'घर',
    pos: 'NOUN',
    script: 'Deva',
    glossDefault: 'house, home',
    frequencyRank: 85,
    translations: [{ sourceId: 'hi-seed:ghar:en:1', body: 'house, home' }],
  },
  {
    sourceId: 'hi-seed:kitab',
    headword: 'किताब',
    pos: 'NOUN',
    script: 'Deva',
    glossDefault: 'book',
    frequencyRank: 340,
    translations: [{ sourceId: 'hi-seed:kitab:en:1', body: 'book' }],
  },
  {
    sourceId: 'hi-seed:bolna',
    headword: 'बोलना',
    pos: 'VERB',
    script: 'Deva',
    glossDefault: 'to speak, to say',
    frequencyRank: 210,
    translations: [
      { sourceId: 'hi-seed:bolna:en:1', body: 'to speak' },
      { sourceId: 'hi-seed:bolna:en:2', body: 'to say, to utter' },
    ],
  },
  {
    sourceId: 'hi-seed:jana',
    headword: 'जाना',
    pos: 'VERB',
    script: 'Deva',
    glossDefault: 'to go',
    frequencyRank: 45,
    translations: [{ sourceId: 'hi-seed:jana:en:1', body: 'to go' }],
  },
  {
    sourceId: 'hi-seed:khana',
    headword: 'खाना',
    pos: 'VERB',
    script: 'Deva',
    glossDefault: 'to eat',
    frequencyRank: 180,
    translations: [{ sourceId: 'hi-seed:khana:en:1', body: 'to eat' }],
  },
  {
    sourceId: 'hi-seed:bada',
    headword: 'बड़ा',
    pos: 'ADJ',
    script: 'Deva',
    glossDefault: 'big, large',
    frequencyRank: 90,
    translations: [{ sourceId: 'hi-seed:bada:en:1', body: 'big, large' }],
  },
  {
    sourceId: 'hi-seed:accha',
    headword: 'अच्छा',
    pos: 'ADJ',
    script: 'Deva',
    glossDefault: 'good',
    frequencyRank: 95,
    translations: [{ sourceId: 'hi-seed:accha:en:1', body: 'good' }],
  },
  {
    // Deliberate homograph example — "सोना" is both noun (gold) and
    // verb (to sleep). Two distinct lemma rows, same headword, differ
    // in POS. Proves the schema's uniqueness key (language, headword,
    // pos) works as intended.
    sourceId: 'hi-seed:sona-noun',
    headword: 'सोना',
    pos: 'NOUN',
    script: 'Deva',
    glossDefault: 'gold',
    frequencyRank: 720,
    translations: [{ sourceId: 'hi-seed:sona-noun:en:1', body: 'gold' }],
  },
  {
    sourceId: 'hi-seed:sona-verb',
    headword: 'सोना',
    pos: 'VERB',
    script: 'Deva',
    glossDefault: 'to sleep',
    frequencyRank: 260,
    translations: [{ sourceId: 'hi-seed:sona-verb:en:1', body: 'to sleep' }],
    forms: [
      { surface: 'सोता', features: { Aspect: 'Hab', Number: 'Sing' } },
      { surface: 'सोती', features: { Aspect: 'Hab', Number: 'Sing', Gender: 'Fem' } },
    ],
  },
];

export const hindiSeedSource: DictionaryImportSource = {
  name: 'hindi-seed',
  language: 'hi',
  sourceAttribution: 'CIA Reader Hindi Seed (public-domain core vocabulary)',
  license: 'CC0-1.0',
  entries: () => ENTRIES,
};
