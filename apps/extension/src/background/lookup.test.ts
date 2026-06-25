import { describe, expect, it } from 'vitest';

import type { ExportedLemma } from '../shared/api-types';
import { lookupWord } from './lookup';

const lemma = (id: string, over: Partial<ExportedLemma> = {}): ExportedLemma => ({
  id,
  headword: 'hasi',
  pos: 'verb',
  gloss: null,
  freq: null,
  translations: [],
  ...over,
});

describe('lookupWord', () => {
  it('collapses duplicate headword+pos rows and merges/dedupes translations', async () => {
    const result = await lookupWord('eu', 'hasiko', {
      resolveLemmas: async () => ['hasi'],
      dictLookup: async () => [
        lemma('1', { translations: [{ body: 'to begin', lang: 'en', kind: 'community' }] }),
        lemma('2'),
        lemma('3', {
          translations: [
            { body: 'to begin', lang: 'en', kind: 'community' },
            { body: 'to start', lang: 'en', kind: 'official' },
          ],
        }),
      ],
    });

    expect(result.lemmas).toEqual(['hasi']);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.translations.map((t) => t.body)).toEqual(['to begin', 'to start']);
  });

  it('falls back to the surface form when parsing yields no lemma', async () => {
    const result = await lookupWord('eu', 'Xabi', {
      resolveLemmas: async () => [],
      dictLookup: async (_l, w) => (w === 'Xabi' ? [lemma('p', { headword: 'Xabi', pos: 'PROPN' })] : []),
    });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.headword).toBe('Xabi');
  });

  it('sorts entries with definitions ahead of empty ones', async () => {
    const result = await lookupWord('eu', 'x', {
      resolveLemmas: async () => ['x'],
      dictLookup: async () => [
        lemma('a', { headword: 'aaa', pos: 'NOUN' }),
        lemma('b', { headword: 'bbb', pos: 'NOUN', gloss: 'has a gloss' }),
      ],
    });
    expect(result.entries[0]!.headword).toBe('bbb');
  });
});
