/**
 * Subtitle-line playback controls: repeat / previous / next line + auto-pause /
 * listening mode (pause at line end, reveal the line).
 *
 * Seeking needs cue timing (from the cached .vtt); the player's currentTime is
 * offset from the .vtt timeline, so we calibrate the offset by matching the
 * on-screen subtitle (from the Shaka mirror) to its cue.
 *
 * Auto-pause/listening is driven by the on-screen subtitle *changing* (rather
 * than a computed end-time window), so adjacent cues with no gap each get their
 * own pause — what you see is what pauses.
 */
import type { SubtitleCue } from '../shared/subtitles';
import type { VideoController } from './video';

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

export class PlaybackController {
  private cues: SubtitleCue[] = [];
  private indexByText = new Map<string, number>();
  private offsetMs = 0;
  private calibrated = false;
  private autoPause = false;
  private listening = false;
  private prevLine: string | null = null;
  private justSeeked = false;

  /** Called while in listening mode with whether the caption should be hidden
   *  (hidden while the line plays, shown when it pauses). */
  onBlind: ((hidden: boolean) => void) | null = null;
  /** Called with a line's text when we pause on it, to reveal it. */
  onLinePause: ((text: string) => void) | null = null;

  constructor(private video: VideoController) {
    setInterval(this.tick, 120);
  }

  setCues(cues: SubtitleCue[]): void {
    this.cues = cues;
    // Only calibrate on lines whose text is UNIQUE — repeated short lines like
    // "(Musika)" would otherwise map to the wrong occurrence and skew the offset.
    const counts = new Map<string, number>();
    for (const c of cues) {
      const k = norm(c.text);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    this.indexByText = new Map();
    cues.forEach((c, i) => {
      const k = norm(c.text);
      if (counts.get(k) === 1) this.indexByText.set(k, i);
    });
  }

  /** The current on-screen subtitle (from the mirror): calibrates the offset and
   *  drives the pause-at-line-end. */
  onText(text: string | null): void {
    const current = text && text.trim() ? text : null;

    // Calibrate the timeline offset on a recognized (unique) line.
    if (current) {
      const i = this.indexByText.get(norm(current));
      const t = this.video.currentTime();
      const cue = i !== undefined ? this.cues[i] : undefined;
      if (i !== undefined && t !== null && cue) {
        this.offsetMs = t * 1000 - cue.startMs;
        this.calibrated = true;
      }
    }

    // Pause on the line CHANGE — the previous line just ended.
    const prev = this.prevLine;
    this.prevLine = current;
    if (this.justSeeked) {
      this.justSeeked = false; // the change a seek caused shouldn't pause
      return;
    }
    if (!prev || current === prev) return;
    if (!this.autoPause && !this.listening) return;
    if (this.video.isPaused()) return;
    this.video.pause();
    this.onLinePause?.(prev);
  }

  /** The subtitle lines immediately before/after the given on-screen line, for
   *  Anki card context. Matches by text, falling back to the calibrated index. */
  neighborsOf(text: string | null): { before: string | null; after: string | null } {
    let i = text ? this.cues.findIndex((c) => norm(c.text) === norm(text)) : -1;
    if (i < 0) i = this.activeIndex();
    if (i < 0) return { before: null, after: null };
    return {
      before: this.cues[i - 1]?.text ?? null,
      after: this.cues[i + 1]?.text ?? null,
    };
  }

  /** Video time (seconds) at the middle of the cue for a given on-screen line —
   *  the representative frame to screenshot for that line. Null if uncalibrated
   *  or the line isn't found. */
  timeForLine(text: string | null): number | null {
    if (!this.calibrated) return null;
    let i = text ? this.cues.findIndex((c) => norm(c.text) === norm(text)) : -1;
    if (i < 0) i = this.activeIndex();
    const c = i >= 0 ? this.cues[i] : undefined;
    return c ? this.toVideo((c.startMs + c.endMs) / 2) : null;
  }

  private toVideo(ms: number): number {
    return (ms + this.offsetMs) / 1000;
  }

  /** Index of the cue the playhead is currently in (or last passed). */
  private activeIndex(): number {
    if (!this.calibrated) return -1;
    const adj = (this.video.currentTime() ?? 0) * 1000 - this.offsetMs;
    let idx = -1;
    for (let i = 0; i < this.cues.length; i += 1) {
      if (this.cues[i]!.startMs <= adj) idx = i;
      else break;
    }
    return idx;
  }

  private seekTo(index: number): void {
    const c = this.cues[index];
    if (c) {
      this.justSeeked = true;
      this.video.seek(this.toVideo(c.startMs) + 0.02);
    }
  }

  repeat(): void {
    this.seekTo(this.activeIndex());
  }

  prev(): void {
    this.seekTo(this.activeIndex() - 1);
  }

  next(): void {
    this.seekTo(this.activeIndex() + 1);
  }

  toggleAutoPause(): boolean {
    this.autoPause = !this.autoPause;
    return this.autoPause;
  }

  toggleListening(): boolean {
    this.listening = !this.listening;
    if (!this.listening) this.onBlind?.(false);
    return this.listening;
  }

  private tick = (): void => {
    if (this.listening) this.onBlind?.(!this.video.isPaused());
  };
}
