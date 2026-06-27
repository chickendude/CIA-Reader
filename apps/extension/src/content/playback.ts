/**
 * Subtitle-line playback: repeat / prev / next line + auto-pause / listening
 * mode, AND the on-screen caption — all driven from the loaded .vtt cues, not
 * the player's own subtitle rendering.
 *
 * The player's currentTime is offset from the .vtt timeline, so we calibrate the
 * offset by matching the player's (hidden) on-screen subtitle to its cue (only
 * UNIQUE-text cues, so repeated lines like "(Musika)" can't skew it). Once
 * calibrated, a per-animation-frame loop computes the active cue from
 * currentTime and:
 *   - paints the caption (so it's OUR subtitle, kept visible when paused),
 *   - in listening mode hides it while the clip plays,
 *   - pauses just BEFORE the active line ends (auto-pause / listening) so the
 *     pause lands ON that line, not the next one.
 */
import type { SubtitleCue } from '../shared/subtitles';
import type { VideoController } from './video';

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
// Pause this far before a line's end so we stay on it (rather than crossing into
// the next cue). Small enough that you still hear ~all of the line.
const PAUSE_LEAD_MS = 60;

export class PlaybackController {
  private cues: SubtitleCue[] = [];
  private indexByText = new Map<string, number>();
  private offsetMs = 0;
  private calibrated = false;
  private autoPause = false;
  private listening = false;
  private pausedFor = -1;
  private raf: ReturnType<typeof requestAnimationFrame> | null = null;

  /** Paint the caption with a line's text (or null to clear). Driven from cues. */
  onDisplay: ((text: string | null) => void) | null = null;

  constructor(private video: VideoController) {
    if (typeof requestAnimationFrame === 'function') this.loop();
  }

  get isCalibrated(): boolean {
    return this.calibrated;
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

  /** The player's (hidden) on-screen subtitle — used ONLY to calibrate the
   *  offset between the .vtt timeline and the video's currentTime. */
  onText(text: string | null): void {
    const current = text && text.trim() ? text : null;
    if (!current) return;
    const i = this.indexByText.get(norm(current));
    const t = this.video.currentTime();
    const cue = i !== undefined ? this.cues[i] : undefined;
    if (i !== undefined && t !== null && cue) {
      this.offsetMs = t * 1000 - cue.startMs;
      this.calibrated = true;
    }
  }

  /** Surrounding subtitle lines for card context. Matches by text, falling back
   *  to the calibrated index. */
  neighborsOf(text: string | null): { before: string | null; after: string | null } {
    let i = text ? this.cues.findIndex((c) => norm(c.text) === norm(text)) : -1;
    if (i < 0) i = this.activeIndex();
    if (i < 0) return { before: null, after: null };
    return {
      before: this.cues[i - 1]?.text ?? null,
      after: this.cues[i + 1]?.text ?? null,
    };
  }

  /** Video time (seconds) at the middle of the cue for a given line — the frame
   *  to screenshot for that line. Null if uncalibrated / not found. */
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

  /** Index of the cue the playhead is in/last passed (for prev/next/repeat). */
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

  /** The cue currently on screen (containing adj), or -1 in a gap. */
  private cueIndexAt(adj: number): number {
    for (let i = 0; i < this.cues.length; i += 1) {
      const c = this.cues[i]!;
      if (c.startMs > adj) break;
      if (adj < c.endMs) return i;
    }
    return -1;
  }

  private seekTo(index: number): void {
    const c = this.cues[index];
    if (c) {
      this.pausedFor = -1;
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
    this.pausedFor = -1;
    return this.autoPause;
  }

  toggleListening(): boolean {
    this.listening = !this.listening;
    this.pausedFor = -1;
    return this.listening;
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    this.pump();
  };

  /** One frame of cue-driven display + pause logic (public for tests). */
  pump(): void {
    if (!this.calibrated || this.cues.length === 0) return;
    const t = this.video.currentTime();
    if (t === null) return;
    const adj = t * 1000 - this.offsetMs;
    const idx = this.cueIndexAt(adj);
    const cue = idx >= 0 ? this.cues[idx] : undefined;
    const paused = this.video.isPaused();

    // Pause just before the active line ends — so we land ON it, not the next.
    if (
      (this.listening || this.autoPause) &&
      !paused &&
      cue &&
      this.pausedFor !== idx &&
      adj >= cue.endMs - PAUSE_LEAD_MS
    ) {
      this.pausedFor = idx;
      this.video.pause();
      this.onDisplay?.(cue.text); // keep the line on screen while paused
      return;
    }

    // Caption comes from the cues. Hidden while a clip plays in listening mode.
    if (this.listening && !paused) this.onDisplay?.(null);
    else this.onDisplay?.(cue?.text ?? null);
  }
}
