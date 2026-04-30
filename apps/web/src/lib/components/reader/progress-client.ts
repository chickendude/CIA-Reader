/**
 * Reader progress write-through (T-5.6).
 *
 * The reader emits frequent "where am I?" events as the user
 * scrolls / paginates. We debounce them in-process so we PATCH at
 * most once every couple of seconds, and skip writes when nothing
 * has actually changed since the last one.
 *
 * Anonymous viewers of an official text don't have a user_id row to
 * write against; the reader gates calls behind `canPersistSettings`
 * before invoking this.
 */

const DEBOUNCE_MS = 1500;

export type ProgressAnchor = {
  chapterIdx: number;
  tokenIdx: number;
  pctRead: number;
};

export type ProgressFlushOptions = {
  /**
   * Use the browser's keepalive request path. This is important for
   * pagehide / refresh, where a normal async fetch is commonly
   * cancelled before the PATCH reaches the server.
   */
  keepalive?: boolean;
};

export class ProgressWriter {
  private readonly textId: string;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSent: ProgressAnchor | null = null;
  private pending: ProgressAnchor | null = null;

  constructor(textId: string) {
    this.textId = textId;
  }

  /**
   * Record a new anchor. Schedules a debounced PATCH; if the same
   * anchor is sent twice in a row, the second one is suppressed.
   */
  schedule(anchor: ProgressAnchor): void {
    this.pending = anchor;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), DEBOUNCE_MS);
  }

  /** Force-flush any pending anchor immediately (e.g. on page hide). */
  async flush(opts: ProgressFlushOptions = {}): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const next = this.pending;
    if (!next) return;
    if (
      this.lastSent &&
      this.lastSent.chapterIdx === next.chapterIdx &&
      this.lastSent.tokenIdx === next.tokenIdx &&
      this.lastSent.pctRead === next.pctRead
    ) {
      this.pending = null;
      return;
    }
    this.lastSent = next;
    this.pending = null;
    try {
      await fetch(`/api/v1/me/text-progress/${this.textId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
        keepalive: opts.keepalive === true,
      });
    } catch {
      // Network blips: drop silently. The next debounced flush
      // recovers, and even if every flush fails the user just
      // resumes at chapter 0 — annoying but not destructive.
    }
  }
}
