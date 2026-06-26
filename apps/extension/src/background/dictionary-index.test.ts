import { describe, expect, it } from 'vitest';

import type { DictionaryExport } from '../shared/api-types';
import {
  buildHeadwordIndex,
  lookupHeadword,
  normalizeHeadword,
  suggestHeadwords,
} from './dictionary-index';

const exported: DictionaryExport = {
  language: 'eu',
  count: 3,
  lemmas: [
    { id: 'L1', headword: 'Etxe', pos: 'NOUN', gloss: 'house', freq: 5, translations: [] },
    { id: 'L2', headword: 'jan', pos: 'VERB', gloss: 'to eat', freq: 8, translations: [] },
    { id: 'L3', headword: 'jan', pos: 'NOUN', gloss: 'food', freq: 40, translations: [] },
  ],
};

describe('normalizeHeadword', () => {
  it('lowercases and trims', () => {
    expect(normalizeHeadword('  Etxe ')).toBe('etxe');
  });
});

describe('buildHeadwordIndex / lookupHeadword', () => {
  const index = buildHeadwordIndex(exported);

  it('looks up case-insensitively', () => {
    expect(lookupHeadword(index, 'etxe').map((l) => l.id)).toEqual(['L1']);
    expect(lookupHeadword(index, 'ETXE').map((l) => l.id)).toEqual(['L1']);
  });

  it('returns every lemma sharing a headword (different POS)', () => {
    const jan = lookupHeadword(index, 'jan');
    expect(jan.map((l) => l.pos).sort()).toEqual(['NOUN', 'VERB']);
  });

  it('returns an empty list for an unknown word', () => {
    expect(lookupHeadword(index, 'zzz')).toEqual([]);
  });
});

describe('suggestHeadwords', () => {
  const index = buildHeadwordIndex(exported);

  it('matches a prefix case-insensitively and returns the original headword', () => {
    expect(suggestHeadwords(index, 'et')).toEqual(['Etxe']);
    expect(suggestHeadwords(index, 'JA')).toEqual(['jan']);
  });

  it('falls back to substring matches', () => {
    expect(suggestHeadwords(index, 'txe')).toEqual(['Etxe']);
  });

  it('returns nothing for a blank prefix', () => {
    expect(suggestHeadwords(index, '  ')).toEqual([]);
  });
});
