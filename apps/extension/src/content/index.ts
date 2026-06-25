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

new SubtitleMirror((text) => {
  overlay.setCue(text);
  playback.onText(text);
});

const toggleAutoPause = () => overlay.setAutoPause(playback.toggleAutoPause());
overlay.enableControls({
  repeat: () => playback.repeat(),
  prev: () => playback.prev(),
  next: () => playback.next(),
  toggleAutoPause,
});

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
      default:
        handled = false;
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
