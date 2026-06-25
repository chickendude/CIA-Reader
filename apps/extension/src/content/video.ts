/**
 * Access to the page's <video> for playback controls (pause-on-lookup, and the
 * repeat/prev/next controls in the next task). Display sync is handled by the
 * subtitle mirror, not from here.
 */
export class VideoController {
  private wasPlaying = false;

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
}
