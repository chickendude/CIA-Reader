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

export class ProgressWriter {
  private readonly textId: string;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSaved: ProgressAnchor | null = null;
  private inFlight: Promise<void> | null = null;
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

  /** Flush the latest position in order, including deliberate backward turns. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.inFlight) await this.inFlight;
    const next = this.pending;
    if (!next) return;
    this.pending = null;
    if (
      this.lastSaved?.chapterIdx === next.chapterIdx &&
      this.lastSaved.tokenIdx === next.tokenIdx &&
      this.lastSaved.pctRead === next.pctRead
    ) return;

    this.inFlight = this.save(next).finally(() => { this.inFlight = null; });
    await this.inFlight;
  }

  private async save(anchor: ProgressAnchor): Promise<void> {
    try {
      const response = await fetch(`/api/v1/me/text-progress/${this.textId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(anchor),
        // A tab can be discarded after a debounced save has already started.
        keepalive: true,
      });
      if (response.ok) {
        this.lastSaved = anchor;
        return;
      }
    } catch {
      // A visibility change or reconnect can retry a failed save.
    }
    // A lost response may still have committed on the server.
    this.lastSaved = null;
    this.pending ??= anchor;
  }
}
