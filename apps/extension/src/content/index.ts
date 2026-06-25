/**
 * Content script — runs on Primeran pages.
 *
 * Display comes from mirroring the player's own subtitle element (perfect sync;
 * see mirror.ts). The background discovers + caches the episode's full .vtt via
 * webRequest; we load those cues here to power the playback controls (repeat /
 * prev / next line, auto-pause). We never patch the page's fetch/XHR.
 */
import { ext } from '../shared/browser';
import { sendMessage } from '../shared/messages';
import type { SubtitleCue } from '../shared/subtitles';
import { SubtitleMirror } from './mirror';
import { Overlay } from './overlay';
import { PlaybackController } from './playback';
import { VideoController } from './video';

// Primeran is Basque.
const LANGUAGE = 'eu';

const video = new VideoController();
const playback = new PlaybackController(video);

const overlay = new Overlay({
  lookup: (surface) => sendMessage('LOOKUP', { language: LANGUAGE, surface }),
  reference: (word) => sendMessage('REFERENCE', { language: LANGUAGE, word }).then((r) => r.results),
  // Pause the video while a word's definition is open, resume on leave.
  onOpen: () => video.pauseForLookup(),
  onClose: () => video.resumeAfterLookup(),
  frequency: (lemma, surface) =>
    sendMessage('FREQUENCY', { language: LANGUAGE, url: location.href, lemma, surface }).then(
      (r) => r.count,
    ),
  addAnki: (card) => sendMessage('ADD_ANKI', { language: LANGUAGE, ...card }),
});

let seenSubs = false;
new SubtitleMirror((text) => {
  if (text) seenSubs = true;
  overlay.setCue(text);
  playback.onText(text);
});

// Listening mode hides/reveals the caption as the line plays/pauses.
playback.onBlind = (hidden) => overlay.setCaptionHidden(hidden);

const toggleAutoPause = () => overlay.setAutoPause(playback.toggleAutoPause());
const toggleListening = () => overlay.setListening(playback.toggleListening());

overlay.enableControls({
  repeat: () => playback.repeat(),
  prev: () => playback.prev(),
  next: () => playback.next(),
  toggleAutoPause,
  toggleListening,
  enableSubtitles: () => void enableBasqueSubtitles(),
});

// --- Turn on Basque subtitles via the player UI (XPaths provided by Primeran) ---
const SUBTITLE_BUTTON_XPATH =
  '/html/body/div[1]/div/div/div/main/div/div/div[4]/footer/span[2]/div/div[1]/button[1]/div/img';
const EUSKARA_BUTTON_XPATH =
  '/html/body/div[1]/div/div/div/main/div/div/div[4]/footer/div[2]/div/span/div/div[1]/div[2]/div[2]/button/div/span';

function byXPath(path: string): HTMLElement | null {
  try {
    const r = document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    return (r.singleNodeValue as HTMLElement) ?? null;
  } catch {
    return null;
  }
}
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function enableBasqueSubtitles(): Promise<void> {
  const subBtn = byXPath(SUBTITLE_BUTTON_XPATH);
  (subBtn?.closest('button') ?? subBtn)?.click();
  await delay(700);
  const eu = byXPath(EUSKARA_BUTTON_XPATH);
  (eu?.closest('button') ?? eu)?.click();
}

// If no subtitle has appeared shortly after load, try to turn them on.
setTimeout(() => {
  if (!seenSubs) void enableBasqueSubtitles();
}, 6000);

// Cues power the playback controls (timing). Load cached ones, and take pushes.
async function loadCues(): Promise<void> {
  try {
    const r = await sendMessage('CUES_FOR_URL', { url: location.href });
    if (r.cues && r.cues.length > 0) playback.setCues(r.cues);
  } catch {
    /* ignore */
  }
}
ext.runtime.onMessage.addListener((message) => {
  const m = message as { type?: string; cues?: SubtitleCue[] };
  if (m.type === 'SUBTITLES_LOADED' && m.cues) playback.setCues(m.cues);
});
void loadCues();

// Reload cues on SPA navigation.
let lastHref = location.href;
setInterval(() => {
  if (location.href !== lastHref) {
    lastHref = location.href;
    void loadCues();
  }
}, 1000);

// Keyboard shortcuts (captured so the player doesn't also act on them).
document.addEventListener(
  'keydown',
  (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    let handled = true;
    switch (e.key) {
      case 'ArrowRight':
        playback.next();
        break;
      case 'ArrowLeft':
        playback.prev();
        break;
      default:
        switch (e.key.toLowerCase()) {
          case 'a':
            playback.repeat();
            break;
          case 's':
            playback.prev();
            break;
          case 'd':
            playback.next();
            break;
          case 'w':
            toggleAutoPause();
            break;
          case 'e':
            toggleListening();
            break;
          default:
            handled = false;
        }
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  },
  true,
);

void sendMessage('PING')
  .then((pong) => console.info('[primeran-miner] content script loaded; background:', pong))
  .catch(() => console.info('[primeran-miner] content script loaded; background unavailable'));
