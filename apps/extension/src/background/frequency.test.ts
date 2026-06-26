import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./subtitles-cache', () => ({ cuesCache: { get: vi.fn() } }));

import type { ParseTokenWire } from '../shared/api-types';
import { FrequencyIndex } from './frequency';
import { memoryKvStore } from './idb';
import { cuesCache } from './subtitles-cache';

const getMock = vi.mocked(cuesCache.get);

const token = (surface: string, lemma: string): ParseTokenWire => ({
  idx: 0,
  surface,
  is_word: true,
  candidates: [{ lemma, pos: 'X', score: 1, features: {} }],
  is_ambiguous: false,
  is_oov: false,
  romanization: null,
});

beforeEach(() => getMock.mockReset());

describe('FrequencyIndex', () => {
  it('counts by lemma across the episode and caches the result', async () => {
    getMock.mockResolvedValue([
      { startMs: 0, endMs: 1, text: 'hasi da' },
      { startMs: 1, endMs: 2, text: 'hasi nahi' },
    ]);
    const postJson = vi.fn().mockResolvedValue({
      language: 'eu',
      tokens: [token('hasi', 'hasi'), token('da', 'izan'), token('hasi', 'hasi'), token('nahi', 'nahi')],
    });
    const idx = new FrequencyIndex(memoryKvStore(), { postJson });

    expect(await idx.count('eu', 'ep', 'Hasi', 'hasi')).toBe(2); // case-insensitive, by lemma
    expect(await idx.count('eu', 'ep', 'izan', 'da')).toBe(1); // lemma rollup of 'da'
    // surface fallback: lemma not found, but the surface was seen
    expect(await idx.count('eu', 'ep', 'egon', 'nahi')).toBe(1);
    expect(await idx.count('eu', 'ep', 'missing', 'missing')).toBe(0);
    // computed once (single chunk), then served from cache
    expect(postJson).toHaveBeenCalledTimes(1);
  });

  it('returns 0 when there are no cached cues', async () => {
    getMock.mockResolvedValue(null);
    const postJson = vi.fn();
    const idx = new FrequencyIndex(memoryKvStore(), { postJson });
    expect(await idx.count('eu', 'ep', 'hasi', 'hasi')).toBe(0);
    expect(postJson).not.toHaveBeenCalled();
  });
});
