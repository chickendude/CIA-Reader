/**
 * Per-chapter token lazy loader (T-5.1a).
 *
 * The reader's SSR loader only ships the active chapter's token rows
 * (a 50-chapter novel would otherwise blow up first-paint). This
 * helper fetches sibling chapters on demand from the
 * `/api/v1/texts/:id/chapters/:idx/tokens` endpoint, deduping
 * concurrent requests for the same chapter and surfacing a tiny
 * status state so a caller (continuous mode) can render a "loading"
 * affordance without juggling its own bookkeeping.
 *
 * Single-shot per chapter — once a fetch resolves we don't refetch,
 * which matches the reader's data flow (status overrides happen
 * client-side via WordPopup, not by re-pulling rows).
 */
import type { ChapterPhraseSpan, ServerToken } from './types.js';

export type ChapterTokensResponse = {
  chapterId: string;
  chapterIdx: number;
  body: string;
  tokens: ServerToken[] | null;
  /** T-14.3: phrase spans, hydrated alongside tokens by the same
   *  endpoint. Empty array when the chapter has tokens but no phrase
   *  matches; null when tokens is also null (unprocessed chapter). */
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
      /** T-14.3: cached alongside tokens so a sibling chapter
       *  scrolled into view repaints with the right phrase
       *  highlights on the next $derived pass. */
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

  /**
   * Kick off (or join) a fetch for `chapterIdx`. Resolves to the
   * fetched body plus tokens (and T-14.3 phrase spans), or null
   * tokens / null spans if the worker hasn't run for that chapter
   * yet. The SSR loader only includes the active chapter body;
   * this on-demand shape lets continuous mode hydrate sibling
   * chapters without bloating first paint.
   */
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
