import { describe, expect, it, vi } from 'vitest';

import type { DictionaryExport, ParseResponse } from '../shared/api-types';
import { LocalDictionary } from './dictionary-local';
import { memoryKvStore } from './idb';
import { ParseCache } from './parse-cache';

const exported: DictionaryExport = {
  language: 'eu',
  count: 1,
  lemmas: [{ id: 'L1', headword: 'etxe', pos: 'NOUN', gloss: 'house', freq: 1, translations: [] }],
};

describe('LocalDictionary', () => {
  it('downloads once, caches, and serves look-ups from memory', async () => {
    const store = memoryKvStore();
    const getJson = vi.fn().mockResolvedValue(exported);
    const dict = new LocalDictionary(store, { getJson });

    expect((await dict.lookup('eu', 'Etxe'))[0]?.gloss).toBe('house');
    // second look-up doesn't re-download
    expect((await dict.lookup('eu', 'etxe'))[0]?.id).toBe('L1');
    expect(getJson).toHaveBeenCalledTimes(1);
    expect(getJson).toHaveBeenCalledWith('/api/v1/dictionary/eu/export');

    expect(await dict.status('eu')).toEqual({ ready: true, count: 1 });
  });

  it('refresh() forces a re-download', async () => {
    const store = memoryKvStore();
    const getJson = vi.fn().mockResolvedValue(exported);
    const dict = new LocalDictionary(store, { getJson });

    await dict.lookup('eu', 'etxe');
    const count = await dict.refresh('eu');

    expect(count).toBe(1);
    expect(getJson).toHaveBeenCalledTimes(2);
  });
});

describe('ParseCache', () => {
  const parseResponse: ParseResponse = {
    language: 'eu',
    tokens: [
      {
        idx: 0,
        surface: 'jaten',
        is_word: true,
        candidates: [{ lemma: 'jan', pos: 'VERB', score: 1, features: {} }],
        is_ambiguous: false,
        is_oov: false,
        romanization: null,
      },
    ],
  };

  it('parses on a miss and serves the cache on a hit', async () => {
    const store = memoryKvStore();
    const postJson = vi.fn().mockResolvedValue(parseResponse);
    const cache = new ParseCache(store, { postJson });

    expect(await cache.resolveLemmas('eu', 'Jaten')).toEqual(['jan']);
    // case-insensitive cache key → second call is a hit, no extra parse
    expect(await cache.resolveLemmas('eu', 'jaten')).toEqual(['jan']);
    expect(postJson).toHaveBeenCalledTimes(1);
    expect(postJson).toHaveBeenCalledWith('/api/v1/parse', { language: 'eu', text: 'Jaten' });
  });

  it('returns an empty list for blank input without calling the backend', async () => {
    const postJson = vi.fn();
    const cache = new ParseCache(memoryKvStore(), { postJson });
    expect(await cache.resolveLemmas('eu', '   ')).toEqual([]);
    expect(postJson).not.toHaveBeenCalled();
  });

  it('degrades to [] (uncached) when the parse call fails', async () => {
    const store = memoryKvStore();
    const postJson = vi.fn().mockRejectedValue(new Error('HTTP 502'));
    const cache = new ParseCache(store, { postJson });
    expect(await cache.resolveLemmas('eu', 'jaten')).toEqual([]);
    // not cached, so a later (working) call still hits the backend
    expect(await store.get('parse:eu:jaten')).toBeNull();
  });
});
