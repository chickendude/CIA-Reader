/**
 * Content script — runs on Primeran pages.
 *
 * Display comes from mirroring the player's own subtitle element (perfect sync;
 * see mirror.ts). The background separately discovers + caches the episode's
 * full .vtt via webRequest (used for word-frequency in a later task). We never
 * patch the page's fetch/XHR (that risked breaking audio/DRM).
 */
import { sendMessage } from '../shared/messages';
import { SubtitleMirror } from './mirror';
import { Overlay } from './overlay';
import { VideoController } from './video';

// Primeran is Basque.
const LANGUAGE = 'eu';

const video = new VideoController();

const overlay = new Overlay({
  lookup: (surface) => sendMessage('LOOKUP', { language: LANGUAGE, surface }),
  reference: (word) => sendMessage('REFERENCE', { language: LANGUAGE, word }).then((r) => r.results),
  // Pause the video while a word's definition is open, resume on leave.
  onOpen: () => video.pauseForLookup(),
  onClose: () => video.resumeAfterLookup(),
  frequency: (lemma) =>
    sendMessage('FREQUENCY', { language: LANGUAGE, url: location.href, lemma }).then((r) => r.count),
});

new SubtitleMirror((text) => overlay.setCue(text));

void sendMessage('PING')
  .then((pong) => console.info('[primeran-miner] content script loaded; background:', pong))
  .catch(() => console.info('[primeran-miner] content script loaded; background unavailable'));
