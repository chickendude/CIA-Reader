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

export class PlaybackController {
  private cues: SubtitleCue[] = [];
  private indexByText = new Map<string, number>();
  private current = -1;
  private offsetMs = 0;
  private calibrated = false;
  private autoPause = false;
  private pausedFor = -1;

  constructor(private video: VideoController) {
    setInterval(this.tick, 120);
  }

  setCues(cues: SubtitleCue[]): void {
    this.cues = cues;
    this.indexByText = new Map(cues.map((c, i) => [norm(c.text), i] as [string, number]));
  }

  /** The current on-screen subtitle (from the mirror); pins the current cue and
   *  recalibrates the timeline offset. */
  onText(text: string | null): void {
    if (!text) return;
    const i = this.indexByText.get(norm(text));
    if (i === undefined) return;
    this.current = i;
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

  repeat(): void {
    const c = this.cues[this.current];
    if (c) this.video.seek(this.toVideo(c.startMs) + 0.02);
  }

  prev(): void {
    if (this.current > 0) {
      this.current -= 1;
      this.repeat();
    }
  }

  next(): void {
    if (this.current >= 0 && this.current < this.cues.length - 1) {
      this.current += 1;
      this.repeat();
    }
  }

  toggleAutoPause(): boolean {
    this.autoPause = !this.autoPause;
    this.pausedFor = -1;
    return this.autoPause;
  }

  private tick = (): void => {
    if (!this.autoPause || this.current < 0 || !this.calibrated) return;
    const c = this.cues[this.current];
    const t = this.video.currentTime();
    if (!c || t === null) return;
    if (t >= this.toVideo(c.endMs) && this.pausedFor !== this.current) {
      this.pausedFor = this.current;
      this.video.pause();
    }
  };
}
