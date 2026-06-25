/**
 * Content script — runs on Primeran pages.
 *
 * The background worker discovers the subtitle `.vtt` via the webRequest API and
 * pushes the parsed cues here (we deliberately do NOT patch the page's fetch/XHR,
 * which would risk breaking the DRM media pipeline / audio). Cues are also cached
 * per-episode, so on revisit we load them without re-enabling subtitles. This
 * script renders the clickable overlay and tracks the active cue.
 */
import { ext } from '../shared/browser';
import { sendMessage } from '../shared/messages';
import type { SubtitleCue } from '../shared/subtitles';
import { Overlay } from './overlay';
import { VideoController } from './video';

// Primeran is Basque.
const LANGUAGE = 'eu';

const overlay = new Overlay({
  lookup: (surface) => sendMessage('LOOKUP', { language: LANGUAGE, surface }),
  reference: (word) => sendMessage('REFERENCE', { language: LANGUAGE, word }).then((r) => r.results),
});
const video = new VideoController((cue) => overlay.setCue(cue?.text ?? null));

const seenUrls = new Set<string>();

function useCues(cues: SubtitleCue[], from: string): void {
  console.info(`[primeran-miner] using ${cues.length} subtitle cues (${from})`);
  video.setCues(cues);
}

// Cues pushed by the background when it observes a fresh .vtt request.
ext.runtime.onMessage.addListener((message) => {
  const m = message as { type?: string; url?: string; cues?: SubtitleCue[] };
  if (m.type === 'SUBTITLES_LOADED' && m.url && m.cues && !seenUrls.has(m.url)) {
    seenUrls.add(m.url);
    useCues(m.cues, 'live');
  }
});

// Load cues cached from a previous visit (no need to re-enable subtitles).
async function loadCachedCues(): Promise<void> {
  try {
    const res = await sendMessage('CUES_FOR_URL', { url: location.href });
    if (res.cues && res.cues.length > 0) useCues(res.cues, 'cached');
  } catch {
    /* ignore — live capture still works */
  }
}

// Primeran is a SPA: re-load cached cues + reset the overlay when the URL changes.
let lastHref = location.href;
setInterval(() => {
  if (location.href !== lastHref) {
    lastHref = location.href;
    seenUrls.clear();
    overlay.setCue(null);
    void loadCachedCues();
  }
}, 1000);

void loadCachedCues();
void sendMessage('PING')
  .then((pong) => console.info('[primeran-miner] content script loaded; background:', pong))
  .catch(() => console.info('[primeran-miner] content script loaded; background unavailable'));
