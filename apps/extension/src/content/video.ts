/**
 * Access to the page's <video> for playback controls (pause-on-lookup, and the
 * repeat/prev/next controls in the next task). Display sync is handled by the
 * subtitle mirror, not from here.
 */
export class VideoController {
  private wasPlaying = false;
  private active = false;

  get element(): HTMLVideoElement | null {
    return this.pickVideo();
  }

  currentTime(): number | null {
    return this.pickVideo()?.currentTime ?? null;
  }

  isPaused(): boolean {
    return this.pickVideo()?.paused ?? true;
  }

  seek(seconds: number): void {
    const v = this.pickVideo();
    if (v) {
      v.currentTime = Math.max(0, seconds);
      void v.play();
    }
  }

  pause(): void {
    this.pickVideo()?.pause();
  }

  play(): void {
    void this.pickVideo()?.play();
  }

  /** Seek WITHOUT auto-playing and resolve once the frame has settled — used to
   *  grab the mined line's exact frame for a card screenshot, then seek back. */
  async seekSettle(seconds: number): Promise<void> {
    const v = this.pickVideo();
    if (!v) return;
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        v.removeEventListener('seeked', finish);
        resolve();
      };
      v.addEventListener('seeked', finish);
      v.currentTime = Math.max(0, seconds);
      setTimeout(finish, 500); // fallback if no 'seeked' fires
    });
  }

  /** Pause for a word lookup. Idempotent: while a lookup is already active
   *  (moving between words keeps the popup open) it's a no-op, so the original
   *  "was playing" state isn't lost. Respects a manual pause (won't auto-resume). */
  pauseForLookup(): void {
    if (this.active) return;
    this.active = true;
    const v = this.pickVideo();
    if (v && !v.paused) {
      this.wasPlaying = true;
      v.pause();
    } else {
      this.wasPlaying = false;
    }
  }

  resumeAfterLookup(): void {
    if (!this.active) return;
    this.active = false;
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
}
