// @vitest-environment node
/**
 * Tests for the per-chapter token lazy loader (T-5.1a).
 */
import { describe, expect, it, vi } from 'vitest';

import { LazyTokenLoader, type ChapterTokensResponse } from './lazy-tokens.js';
import type { ServerToken } from './types.js';

function fakeTokens(n: number): ServerToken[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `t-${i}`,
    idx: i,
    surface: `w${i}`,
    isWord: true,
    isAmbiguous: false,
    isOov: false,
    lemmaId: `lem-${i}`,
    romanization: null,
    glossDefault: null,
    personalGloss: null,
    candidates: [],
    features: {},
    numberForms: null,
    status: 'unknown',
  }));
}

describe('LazyTokenLoader', () => {
  it('fetches tokens once per chapter and caches the result', async () => {
    const fetcher = vi
      .fn<(textId: string, idx: number) => Promise<ChapterTokensResponse>>()
      .mockImplementation(async (_textId, idx) => ({
        chapterId: `c-${idx}`,
        chapterIdx: idx,
        body: `body ${idx}`,
        tokens: fakeTokens(2),
        phraseSpans: [],
      }));
    const loader = new LazyTokenLoader('text-1', fetcher);
    const a = await loader.load(2);
    const b = await loader.load(2);
    expect(a.tokens).toHaveLength(2);
    expect(a.body).toBe('body 2');
    expect(a.phraseSpans).toEqual([]);
    expect(b).toEqual(a);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent loads for the same chapter', async () => {
    let resolveFn: ((v: ChapterTokensResponse) => void) | null = null;
    const promise = new Promise<ChapterTokensResponse>((resolve) => {
      resolveFn = resolve;
    });
    const fetcher = vi.fn().mockReturnValue(promise);
    const loader = new LazyTokenLoader('t1', fetcher);
    const p1 = loader.load(1);
    const p2 = loader.load(1);
    resolveFn!({
      chapterId: 'c1',
      chapterIdx: 1,
      body: 'body 1',
      tokens: null,
      phraseSpans: null,
    });
    const [a, b] = await Promise.all([p1, p2]);
    expect(a.tokens).toBeNull();
    expect(a.body).toBe('body 1');
    expect(a.phraseSpans).toBeNull();
    expect(b).toEqual(a);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('reports loading state while a fetch is in flight', async () => {
    const fetcher = vi
      .fn()
      .mockReturnValue(
        new Promise<ChapterTokensResponse>(() => {
          /* never resolves */
        }),
      );
    const loader = new LazyTokenLoader('t1', fetcher);
    expect(loader.state(0)).toEqual({ kind: 'idle' });
    void loader.load(0);
    expect(loader.state(0)).toEqual({ kind: 'loading' });
  });

  it('records error state when the fetch rejects', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('boom'));
    const loader = new LazyTokenLoader('t1', fetcher);
    await expect(loader.load(0)).rejects.toThrow('boom');
    expect(loader.state(0)).toEqual({ kind: 'error', message: 'boom' });
  });

  it('passes through a null tokens response (worker has not run yet)', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      chapterId: 'c1',
      chapterIdx: 1,
      body: 'fallback body',
      tokens: null,
      phraseSpans: null,
    });
    const loader = new LazyTokenLoader('t1', fetcher);
    expect(await loader.load(1)).toMatchObject({
      body: 'fallback body',
      tokens: null,
      phraseSpans: null,
    });
    expect(loader.state(1)).toEqual({
      kind: 'loaded',
      chapterId: 'c1',
      chapterIdx: 1,
      body: 'fallback body',
      tokens: null,
      phraseSpans: null,
    });
  });
});
