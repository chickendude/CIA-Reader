/**
 * Content script — runs on Primeran pages.
 *
 * The background worker discovers the subtitle `.vtt` via the webRequest API and
 * pushes the parsed cues here (we deliberately do NOT patch the page's fetch/XHR,
 * which would risk breaking the DRM media pipeline / audio). This script just
 * renders the clickable overlay and tracks the active cue.
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

ext.runtime.onMessage.addListener((message) => {
  const m = message as { type?: string; url?: string; cues?: SubtitleCue[] };
  if (m.type === 'SUBTITLES_LOADED' && m.url && m.cues && !seenUrls.has(m.url)) {
    seenUrls.add(m.url);
    console.info(`[primeran-miner] loaded ${m.cues.length} subtitle cues from`, m.url);
    video.setCues(m.cues);
  }
});

void sendMessage('PING')
  .then((pong) => console.info('[primeran-miner] content script loaded; background:', pong))
  .catch(() => console.info('[primeran-miner] content script loaded; background unavailable'));
