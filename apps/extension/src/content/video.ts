/**
 * Tracks the active subtitle cue as playback progresses.
 *
 * There's no native cuechange (the player renders captions itself), so we poll.
 * Crucially we re-pick the *currently playing* <video> on every tick: Primeran
 * can have more than one <video> and can swap the element (quality/fullscreen),
 * and binding to a stale one made the overlay freeze a cue behind. Also exposes
 * pause-on-lookup.
 */
import { activeCueAt, type SubtitleCue } from '../shared/subtitles';

const TICK_MS = 150;

export class VideoController {
  private cues: SubtitleCue[] = [];
  private current: SubtitleCue | null = null;
  private wasPlaying = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private onCueChange: (cue: SubtitleCue | null) => void) {}

  setCues(cues: SubtitleCue[]): void {
    this.cues = cues;
    this.timer ??= setInterval(this.tick, TICK_MS);
    this.tick();
  }

  get element(): HTMLVideoElement | null {
    return this.pickVideo();
  }

  pauseForLookup(): void {
    const v = this.pickVideo();
    if (v && !v.paused) {
      this.wasPlaying = true;
      v.pause();
    } else {
      this.wasPlaying = false;
    }
  }

  resumeAfterLookup(): void {
    const v = this.pickVideo();
    if (v && this.wasPlaying) void v.play();
    this.wasPlaying = false;
  }

  /** The main, actively-playing <video>: prefer a non-paused one, then largest. */
  private pickVideo(): HTMLVideoElement | null {
    const vids = [...document.querySelectorAll('video')].filter(
      (v) => v.readyState >= 1 && (v.duration || 0) > 0,
    );
    if (vids.length === 0) return null;
    const playing = vids.filter((v) => !v.paused);
    const pool = playing.length > 0 ? playing : vids;
    pool.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
    return pool[0] ?? null;
  }

  private tick = (): void => {
    const v = this.pickVideo();
    if (!v) return;
    const cue = activeCueAt(this.cues, v.currentTime * 1000);
    if (cue !== this.current) {
      this.current = cue;
      this.onCueChange(cue);
    }
  };
}
