/**
 * Content script — runs on Primeran pages at document_start.
 *
 * Injects the MAIN-world network shim (which discovers the subtitle `.vtt` URL),
 * asks the background to fetch + parse it into cues, then drives the clickable
 * overlay: it shows the active cue's words and looks them up on click. Playback
 * controls + episode frequency layer on next.
 */
import { ext } from '../shared/browser';
import { sendMessage } from '../shared/messages';
import type { SubtitleCue } from '../shared/subtitles';
import { Overlay } from './overlay';
import { VideoController } from './video';

// Primeran is Basque.
const LANGUAGE = 'eu';

const seenUrls = new Set<string>();

const overlay = new Overlay({
  lookup: (surface) => sendMessage('LOOKUP', { language: LANGUAGE, surface }),
  reference: (word) => sendMessage('REFERENCE', { language: LANGUAGE, word }).then((r) => r.results),
});
const video = new VideoController((cue) => overlay.setCue(cue?.text ?? null));

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
    const cues: SubtitleCue[] = res.cues;
    console.info(`[primeran-miner] loaded ${cues.length} subtitle cues from`, url);
    video.setCues(cues);
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
