/**
 * Tracks the page's <video> and reports the active subtitle cue as playback
 * progresses (there's no native cuechange — we derive it from currentTime). Also
 * exposes pause-on-lookup. Playback controls (repeat/prev/next/auto-pause) extend
 * this in the next task.
 */
import { activeCueAt, type SubtitleCue } from '../shared/subtitles';

export class VideoController {
  private video: HTMLVideoElement | null = null;
  private cues: SubtitleCue[] = [];
  private current: SubtitleCue | null = null;
  private wasPlaying = false;
  private poll: ReturnType<typeof setInterval> | null = null;

  constructor(private onCueChange: (cue: SubtitleCue | null) => void) {}

  setCues(cues: SubtitleCue[]): void {
    this.cues = cues;
    this.ensureVideo();
  }

  get element(): HTMLVideoElement | null {
    return this.video;
  }

  pauseForLookup(): void {
    if (this.video && !this.video.paused) {
      this.wasPlaying = true;
      this.video.pause();
    } else {
      this.wasPlaying = false;
    }
  }

  resumeAfterLookup(): void {
    if (this.video && this.wasPlaying) {
      void this.video.play();
    }
    this.wasPlaying = false;
  }

  private ensureVideo(): void {
    if (this.attach()) return;
    // The SPA mounts <video> asynchronously; poll until it appears.
    this.poll ??= setInterval(() => {
      if (this.attach() && this.poll) {
        clearInterval(this.poll);
        this.poll = null;
      }
    }, 500);
  }

  private attach(): boolean {
    const v = document.querySelector('video');
    if (v && v !== this.video) {
      this.video = v;
      v.addEventListener('timeupdate', this.tick);
      v.addEventListener('seeking', this.tick);
    }
    return !!this.video;
  }

  private tick = (): void => {
    if (!this.video) return;
    const cue = activeCueAt(this.cues, this.video.currentTime * 1000);
    if (cue !== this.current) {
      this.current = cue;
      this.onCueChange(cue);
    }
  };
}
