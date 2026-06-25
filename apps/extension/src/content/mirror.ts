/**
 * Mirror Primeran's native subtitle (Shaka Player renders it into
 * `.shaka-text-container`, perfectly in sync with the video).
 *
 * Rather than re-derive timing from the .vtt + video.currentTime (which is
 * offset from the player's timeline), we read the rendered subtitle text
 * directly and drive our clickable overlay from it — so it's always in sync —
 * and hide the native rendering so only the clickable layer is visible.
 */
const NATIVE_SELECTOR = '.shaka-text-container';
const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

export class SubtitleMirror {
  private last = '';

  constructor(private onText: (text: string | null) => void) {
    this.injectHideStyle();
    setInterval(this.tick, 150);
    this.tick();
  }

  private injectHideStyle(): void {
    const style = document.createElement('style');
    style.id = 'primeran-miner-hide-native';
    // opacity:0 (not display:none) so Shaka keeps updating the text we read.
    style.textContent = `${NATIVE_SELECTOR} { opacity: 0 !important; }`;
    (document.head ?? document.documentElement).append(style);
  }

  private tick = (): void => {
    const el = document.querySelector<HTMLElement>(NATIVE_SELECTOR);
    // innerText respects line breaks (adds a newline) so words on separate
    // subtitle lines don't get glued together; textContent is the fallback.
    const text = el ? norm(el.innerText || el.textContent || '') : '';
    if (text !== this.last) {
      this.last = text;
      this.onText(text || null);
    }
  };
}
