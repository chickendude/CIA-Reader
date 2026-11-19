/**
 * Load chapters on demand. Readers opening a long book only need the current chapter at first,
 * and simultaneous requests for the same chapter can share one response.
 */
import type { ChapterPhraseSpan, ServerToken } from './types.js';

export type ChapterTokensResponse = {
  chapterId: string;
  chapterIdx: number;
  body: string;
  tokens: ServerToken[] | null;
  /** Null until the words are processed. An empty list means no phrases matched. */
  phraseSpans: ChapterPhraseSpan[] | null;
};

export type FetchState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | {
      kind: 'loaded';
      chapterId: string;
      chapterIdx: number;
      body: string;
      tokens: ServerToken[] | null;
      phraseSpans: ChapterPhraseSpan[] | null;
    }
  | { kind: 'error'; message: string };

export type ChapterTokenFetcher = (
  textId: string,
  chapterIdx: number,
) => Promise<ChapterTokensResponse>;

export const defaultFetcher: ChapterTokenFetcher = async (textId, idx) => {
  const res = await fetch(
    `/api/v1/texts/${encodeURIComponent(textId)}/chapters/${idx}/tokens`,
  );
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as ChapterTokensResponse;
};

/**
 * Tracks per-chapter fetch state. Reused across mounts of a single
 * reader page so a chapter scrolled out and back in doesn't refetch.
 */
export class LazyTokenLoader {
  private states = new Map<number, FetchState>();
  private inflight = new Map<number, Promise<ChapterTokensResponse>>();

  constructor(
    private readonly textId: string,
    private readonly fetcher: ChapterTokenFetcher = defaultFetcher,
  ) {}

  state(chapterIdx: number): FetchState {
    return this.states.get(chapterIdx) ?? { kind: 'idle' };
  }

  /** A chapter that is still being processed may have text but no tokens or phrase matches yet. */
  async load(chapterIdx: number): Promise<ChapterTokensResponse> {
    const existing = this.states.get(chapterIdx);
    if (existing?.kind === 'loaded') {
      return {
        chapterId: existing.chapterId,
        chapterIdx: existing.chapterIdx,
        body: existing.body,
        tokens: existing.tokens,
        phraseSpans: existing.phraseSpans,
      };
    }
    const existingPromise = this.inflight.get(chapterIdx);
    if (existingPromise) {
      return await existingPromise;
    }
    this.states.set(chapterIdx, { kind: 'loading' });
    const promise = this.fetcher(this.textId, chapterIdx);
    this.inflight.set(chapterIdx, promise);
    try {
      const r = await promise;
      this.states.set(chapterIdx, {
        kind: 'loaded',
        chapterId: r.chapterId,
        chapterIdx: r.chapterIdx,
        body: r.body,
        tokens: r.tokens,
        phraseSpans: r.phraseSpans,
      });
      return r;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Fetch failed';
      this.states.set(chapterIdx, { kind: 'error', message });
      throw err;
    } finally {
      this.inflight.delete(chapterIdx);
    }
  }
}
