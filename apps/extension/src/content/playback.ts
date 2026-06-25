/**
 * Subtitle-line playback controls: repeat / previous / next line + auto-pause at
 * line end.
 *
 * Seeking needs cue timing (from the cached .vtt). The player's currentTime is
 * offset from the .vtt timeline, so we calibrate the offset continuously by
 * matching the on-screen subtitle text (fed from the Shaka mirror) to its cue —
 * giving an accurate cue-time → video-time mapping for seeks and the line-end
 * auto-pause.
 */
import type { SubtitleCue } from '../shared/subtitles';
import type { VideoController } from './video';

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

// Pause slightly before the cue's end so the subtitle is still on screen (so the
// mirror still has its text to reveal) and the audio is essentially complete.
const PAUSE_LEAD_MS = 120;

export class PlaybackController {
  private cues: SubtitleCue[] = [];
  private indexByText = new Map<string, number>();
  private offsetMs = 0;
  private calibrated = false;
  private autoPause = false;
  private listening = false;
  private pausedFor = -1;

  /** Called while in listening mode with whether the caption should be hidden
   *  (hidden while the line plays, shown when it pauses at the end). */
  onBlind: ((hidden: boolean) => void) | null = null;
  /** Called with the current line's text when auto-pause/listening pauses, so the
   *  caption is shown from the cue data (not relying on the player's DOM). */
  onLinePause: ((text: string) => void) | null = null;

  constructor(private video: VideoController) {
    setInterval(this.tick, 120);
  }

  setCues(cues: SubtitleCue[]): void {
    this.cues = cues;
    // Only calibrate on lines whose text is UNIQUE — repeated short lines like
    // "(Musika)" would otherwise map to the wrong (last) occurrence and throw the
    // timeline offset off by minutes.
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

  /** The current on-screen subtitle (from the mirror) — used only to calibrate
   *  the timeline offset; the current line itself is derived from playback time. */
  onText(text: string | null): void {
    if (!text) return;
    const i = this.indexByText.get(norm(text));
    if (i === undefined) return;
    this.pausedFor = -1;
    const t = this.video.currentTime();
    const cue = this.cues[i];
    if (t !== null && cue) {
      this.offsetMs = t * 1000 - cue.startMs;
      this.calibrated = true;
    }
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
    if (c) this.video.seek(this.toVideo(c.startMs) + 0.02);
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

  /** Listening mode: hide the subtitle while the line plays, pause at its end,
   *  and reveal the subtitle. */
  toggleListening(): boolean {
    this.listening = !this.listening;
    this.pausedFor = -1;
    if (!this.listening) this.onBlind?.(false); // un-hide the caption on exit
    return this.listening;
  }

  private tick = (): void => {
    if (this.listening) this.onBlind?.(!this.video.isPaused());

    if ((!this.autoPause && !this.listening) || !this.calibrated) return;
    const i = this.activeIndex();
    const c = this.cues[i];
    const t = this.video.currentTime();
    if (!c || t === null) return;
    if (t >= this.toVideo(c.endMs - PAUSE_LEAD_MS) && this.pausedFor !== i) {
      this.pausedFor = i;
      this.video.pause();
      this.onLinePause?.(c.text);
    }
  };
}
