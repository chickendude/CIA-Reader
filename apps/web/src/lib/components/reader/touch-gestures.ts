/**
 * Touch-gesture helpers for the reader (T-5.1c).
 *
 * Pure logic split out so swipe / long-press behavior is unit-tested
 * without rendering a Svelte component. The Svelte side (page mode,
 * ChapterBody) wraps these in `onTouchStart` / `onTouchMove` /
 * `onTouchEnd` listeners.
 */

export interface SwipeResult {
  /** -1 swipe-left (next page), +1 swipe-right (prev page), 0 no swipe. */
  direction: -1 | 0 | 1;
  /** Horizontal travel in CSS pixels — useful for live-preview drag UI. */
  dx: number;
  /** Vertical travel — used to disqualify scrolly drags. */
  dy: number;
}

/**
 * Decide whether a touch start/end pair counts as a horizontal swipe.
 * Vertical-dominant movement is treated as a scroll and ignored.
 *
 * The 50px threshold matches what feels natural on a phone: too small
 * and a normal scroll registers as a flip; too big and the user has
 * to drag halfway across the screen.
 */
export function classifySwipe(
  start: { x: number; y: number },
  end: { x: number; y: number },
  thresholdPx = 50,
): SwipeResult {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < thresholdPx) return { direction: 0, dx, dy };
  // Vertical motion dominates → user was scrolling, not flipping pages.
  if (Math.abs(dy) > Math.abs(dx)) return { direction: 0, dx, dy };
  return { direction: dx > 0 ? 1 : -1, dx, dy };
}

/**
 * Long-press detection state machine. The reader's tap target is too
 * small for some users to land precisely, and a long-press is the
 * conventional alternative for "open this thing's details panel" on
 * touch devices.
 *
 * The contract:
 *  - `start(point)` arms a timer that fires `onLongPress(point)` after
 *    `holdMs` if no `cancel()` came in first.
 *  - Movement past `slopPx` cancels the press (it was a drag).
 *  - `release()` cancels the press without firing (a tap or fast
 *    flick already happened).
 */
export interface LongPressOptions {
  holdMs?: number;
  slopPx?: number;
  setTimeout?: (cb: () => void, ms: number) => number;
  clearTimeout?: (handle: number) => void;
}

export class LongPressDetector {
  private timer: number | null = null;
  private start: { x: number; y: number } | null = null;
  private readonly holdMs: number;
  private readonly slopPx: number;
  private readonly setTimer: (cb: () => void, ms: number) => number;
  private readonly clearTimer: (handle: number) => void;

  constructor(
    private readonly onLongPress: (point: { x: number; y: number }) => void,
    options: LongPressOptions = {},
  ) {
    this.holdMs = options.holdMs ?? 500;
    this.slopPx = options.slopPx ?? 8;
    // Tests inject deterministic timer callbacks; runtime defaults to
    // window.setTimeout / clearTimeout.
    this.setTimer =
      options.setTimeout ?? ((cb, ms) => window.setTimeout(cb, ms));
    this.clearTimer =
      options.clearTimeout ?? ((handle) => window.clearTimeout(handle));
  }

  begin(point: { x: number; y: number }): void {
    this.cancel();
    this.start = point;
    this.timer = this.setTimer(() => {
      if (this.start) this.onLongPress(this.start);
      this.timer = null;
    }, this.holdMs);
  }

  /** Called on touchmove. Returns true if the press was cancelled. */
  move(point: { x: number; y: number }): boolean {
    if (!this.start) return false;
    const dx = point.x - this.start.x;
    const dy = point.y - this.start.y;
    if (Math.hypot(dx, dy) > this.slopPx) {
      this.cancel();
      return true;
    }
    return false;
  }

  /** Called on touchend / pointerup — long press is no longer valid. */
  release(): void {
    this.cancel();
  }

  cancel(): void {
    if (this.timer != null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    this.start = null;
  }

  /** True while a press is being measured. Tests assert against this. */
  get armed(): boolean {
    return this.timer != null;
  }
}
