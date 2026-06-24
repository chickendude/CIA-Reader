/**
 * Content script — runs on Primeran pages at document_start.
 *
 * It injects the MAIN-world network shim (which discovers the subtitle `.vtt`
 * URL), then asks the background worker to fetch + parse it into cues. The
 * clickable overlay, playback controls, and frequency counting build on these
 * cues (subsequent tasks); for now it loads them and logs.
 */
import { ext } from '../shared/browser';
import { sendMessage } from '../shared/messages';
import type { SubtitleCue } from '../shared/subtitles';

const seenUrls = new Set<string>();
let cues: SubtitleCue[] = [];

function injectNetIntercept(): void {
  try {
    const script = document.createElement('script');
    script.src = ext.runtime.getURL('net-intercept.js');
    script.onload = () => script.remove();
    (document.head ?? document.documentElement).appendChild(script);
  } catch (e) {
    console.warn('[primeran-miner] failed to inject net-intercept', e);
  }
}

async function onSubtitleUrl(url: string): Promise<void> {
  if (seenUrls.has(url)) return;
  seenUrls.add(url);
  try {
    const res = await sendMessage('FETCH_SUBTITLES', { url });
    cues = res.cues;
    console.info(`[primeran-miner] loaded ${cues.length} subtitle cues from`, url);
    // TODO(overlay): render clickable cues, wire playback + frequency from here.
  } catch (e) {
    console.warn('[primeran-miner] subtitle fetch failed', e);
  }
}

window.addEventListener('message', (ev: MessageEvent) => {
  if (ev.source !== window) return;
  const data = ev.data as { source?: string; kind?: string; url?: string } | null;
  if (data?.source === 'primeran-miner' && data.kind === 'subtitle-url' && data.url) {
    void onSubtitleUrl(data.url);
  }
});

function init(): void {
  injectNetIntercept();
  void sendMessage('PING')
    .then((pong) => console.info('[primeran-miner] content script loaded; background:', pong))
    .catch(() => console.info('[primeran-miner] content script loaded; background unavailable'));
}

init();
