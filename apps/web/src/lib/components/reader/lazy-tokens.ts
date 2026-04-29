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
import type { ServerToken } from './types.js';

export type ChapterTokensResponse = {
  chapterId: string;
  chapterIdx: number;
  tokens: ServerToken[] | null;
};

export type FetchState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; tokens: ServerToken[] | null }
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
   * fetched tokens or null if the worker hasn't run for that chapter
   * yet — same shape the SSR loader returns for the active chapter,
   * so callers can drop the result straight into the ChapterView.
   */
  async load(chapterIdx: number): Promise<ServerToken[] | null> {
    const existing = this.states.get(chapterIdx);
    if (existing?.kind === 'loaded') return existing.tokens;
    const existingPromise = this.inflight.get(chapterIdx);
    if (existingPromise) {
      const r = await existingPromise;
      return r.tokens;
    }
    this.states.set(chapterIdx, { kind: 'loading' });
    const promise = this.fetcher(this.textId, chapterIdx);
    this.inflight.set(chapterIdx, promise);
    try {
      const r = await promise;
      this.states.set(chapterIdx, { kind: 'loaded', tokens: r.tokens });
      return r.tokens;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Fetch failed';
      this.states.set(chapterIdx, { kind: 'error', message });
      throw err;
    } finally {
      this.inflight.delete(chapterIdx);
    }
  }
}
