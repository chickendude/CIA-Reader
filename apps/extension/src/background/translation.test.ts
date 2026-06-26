import { describe, expect, it, vi } from 'vitest';

import type { KvStore } from './idb';
import { TranslationCache } from './translation';

function memStore(): KvStore {
  const map = new Map<string, unknown>();
  return {
    get: async <T>(k: string) => (map.has(k) ? (map.get(k) as T) : null),
    set: async (k: string, v: unknown) => {
      map.set(k, v);
    },
    delete: async (k: string) => {
      map.delete(k);
    },
  };
}

describe('TranslationCache', () => {
  it('fetches once and serves repeats from the cache', async () => {
    const postJson = vi.fn().mockResolvedValue({ translation: 'Let us go to the garden.' });
    const cache = new TranslationCache(memStore(), { postJson });

    const a = await cache.translate('eu', 'Goazen baratzera.', 'en');
    const b = await cache.translate('eu', 'Goazen baratzera.', 'en');

    expect(a).toBe('Let us go to the garden.');
    expect(b).toBe('Let us go to the garden.');
    expect(postJson).toHaveBeenCalledTimes(1);
    expect(postJson).toHaveBeenCalledWith('/api/v1/translate-text', {
      language: 'eu',
      text: 'Goazen baratzera.',
      targetLanguage: 'en',
      cachedOnly: false,
    });
  });

  it('passes cachedOnly through and returns null on a cache miss', async () => {
    const postJson = vi.fn().mockResolvedValue({ translation: null });
    const cache = new TranslationCache(memStore(), { postJson });

    const result = await cache.translate('eu', 'Goazen baratzera.', 'en', true);
    expect(result).toBeNull();
    expect(postJson).toHaveBeenCalledWith('/api/v1/translate-text', {
      language: 'eu',
      text: 'Goazen baratzera.',
      targetLanguage: 'en',
      cachedOnly: true,
    });
  });

  it('keys the cache by target language', async () => {
    const postJson = vi
      .fn()
      .mockResolvedValueOnce({ translation: 'to the garden' })
      .mockResolvedValueOnce({ translation: 'al jardín' });
    const cache = new TranslationCache(memStore(), { postJson });

    expect(await cache.translate('eu', 'baratzera', 'en')).toBe('to the garden');
    expect(await cache.translate('eu', 'baratzera', 'es')).toBe('al jardín');
    expect(postJson).toHaveBeenCalledTimes(2);
  });
});
