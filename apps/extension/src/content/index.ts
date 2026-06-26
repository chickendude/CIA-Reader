/**
 * Content script — runs on Primeran pages.
 *
 * Display comes from mirroring the player's own subtitle element (perfect sync;
 * see mirror.ts). The background discovers + caches the episode's full .vtt via
 * webRequest; we load those cues here to power the playback controls (repeat /
 * prev / next line, auto-pause). We never patch the page's fetch/XHR.
 */
import { ext } from '../shared/browser';
import { DEFAULT_CONFIG, loadConfig, type ExtensionConfig } from '../shared/config';
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

// Live config (popup/options can change it via storage).
let config: ExtensionConfig = DEFAULT_CONFIG;
ext.storage.onChanged.addListener(() => {
  void loadConfig().then((c) => (config = c));
});

const overlay = new Overlay({
  lookup: (surface) => sendMessage('LOOKUP', { language: LANGUAGE, surface }),
  reference: (word) => sendMessage('REFERENCE', { language: LANGUAGE, word }).then((r) => r.results),
  // Pause the video while a word's definition is open (if enabled), resume on leave.
  onOpen: () => {
    if (config.pauseOnLookup) video.pauseForLookup();
  },
  onClose: () => video.resumeAfterLookup(),
  frequency: (lemma, surface) =>
    sendMessage('FREQUENCY', { language: LANGUAGE, url: location.href, lemma, surface }).then(
      (r) => r.count,
    ),
  addAnki: async (card) => {
    let screenshot: string | null = null;
    let note: string | undefined;
    if (config.captureMedia) {
      // The frame is DRM/HDCP-protected, so a <video>→canvas grab comes back
      // black. captureVisibleTab (an OS-level tab grab) gets the real pixels;
      // we just hide our overlay + the player's controls first, and suppress the
      // popup's auto-close so adding a card doesn't dismiss it / resume playback.
      overlay.beginCapture();
      setPlayerChromeHidden(true);
      await delay(120);
      const res = await sendMessage('CAPTURE_SCREENSHOT', {}).catch(() => ({
        dataUrl: null,
        error: 'capture message failed',
      }));
      setPlayerChromeHidden(false);
      overlay.endCapture();
      if (res.dataUrl) screenshot = await cropToVideo(res.dataUrl);
      else note = `no screenshot${res.error ? ` (${res.error})` : ''}`;
    }
    const { before, after } = playback.neighborsOf(card.sentence);
    const result = await sendMessage('ADD_ANKI', {
      language: LANGUAGE,
      ...card,
      screenshot,
      contextBefore: before,
      contextAfter: after,
    });
    return { ...result, note };
  },
  ankiHas: (front) => sendMessage('ANKI_HAS', { front }).then((r) => r.exists),
  lookupLemma: (lemma) => sendMessage('LOOKUP', { language: LANGUAGE, surface: lemma, lemma }),
  suggest: (prefix) =>
    sendMessage('DICT_SUGGEST', { language: LANGUAGE, prefix }).then((r) => r.headwords),
  translate: (text, targetLanguage, cachedOnly) =>
    sendMessage('TRANSLATE', { language: LANGUAGE, text, targetLanguage, cachedOnly }).then(
      (r) => r.translation,
    ),
});

// Hide the player's control overlay during a capture WITHOUT touching the video
// or its ancestors. We walk up from the <video> a few levels and hide each
// sibling that isn't on the path to the video — that catches the play/skip
// overlay, gradient scrims, etc. regardless of their (unknown) class names,
// while the video itself (and so the captured frame) stays visible.
let hiddenChrome: HTMLElement[] = [];
function setPlayerChromeHidden(hidden: boolean): void {
  if (hidden) {
    hiddenChrome = [];
    const v = video.element;
    if (!v) return;
    let node: HTMLElement = v;
    for (let depth = 0; depth < 4; depth += 1) {
      const parent: HTMLElement | null = node.parentElement;
      if (!parent) break;
      for (const child of Array.from(parent.children)) {
        const elc = child as HTMLElement;
        if (elc === node || elc.contains(v) || elc.style.visibility === 'hidden') continue;
        elc.style.visibility = 'hidden';
        hiddenChrome.push(elc);
      }
      node = parent;
    }
  } else {
    for (const elc of hiddenChrome) elc.style.visibility = '';
    hiddenChrome = [];
  }
}

/** Crop a full-tab screenshot down to the video element's rectangle. */
async function cropToVideo(dataUrl: string): Promise<string> {
  const v = video.element;
  if (!v) return dataUrl;
  const rect = v.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return dataUrl;
  const dpr = window.devicePixelRatio || 1;
  try {
    const img = new Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('image load failed'));
      img.src = dataUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.drawImage(
      img,
      rect.x * dpr,
      rect.y * dpr,
      rect.width * dpr,
      rect.height * dpr,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    return canvas.toDataURL('image/jpeg', 0.82);
  } catch {
    return dataUrl;
  }
}

let seenSubs = false;
let subAttempted = false;
new SubtitleMirror((text) => {
  // While paused, ignore the player clearing the line — keep it visible to read.
  if (!text && video.isPaused()) return;
  if (text) seenSubs = true;
  overlay.setCue(text);
  playback.onText(text);
});

// Listening mode hides/reveals the caption as the line plays/pauses.
playback.onBlind = (hidden) => overlay.setCaptionHidden(hidden);
// On auto-pause/listening pause, force-show the line from the cue data.
playback.onLinePause = (text) => {
  overlay.setCaptionHidden(false);
  overlay.setCue(text);
};

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

// Apply initial config (auto-pause default).
void loadConfig().then((c) => {
  config = c;
  if (c.autoPauseAtLineEnd) toggleAutoPause();
});

// Auto-enable Basque subtitles: once the player is up and if none are showing,
// attempt once per page (re-armed on navigation). Waits for the player so the
// menu buttons exist (unlike the old one-shot timer).
setInterval(() => {
  if (subAttempted || seenSubs || !config.autoEnableSubtitles || !video.element) return;
  subAttempted = true;
  setTimeout(() => {
    if (!seenSubs) void enableBasqueSubtitles();
  }, 1500);
}, 1500);

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

// Reload cues + re-arm the subtitle auto-enable on SPA navigation.
let lastHref = location.href;
setInterval(() => {
  if (location.href !== lastHref) {
    lastHref = location.href;
    seenSubs = false;
    subAttempted = false;
    void loadCues();
  }
}, 1000);

// Keyboard shortcuts. Registered on window in the capture phase so they fire
// before the player's own handlers (which otherwise eat the arrow keys).
window.addEventListener(
  'keydown',
  (e) => {
    // composedPath()[0] is the real focused element even inside our shadow root,
    // so typing in the popup's form input isn't hijacked by playback shortcuts.
    const t = (e.composedPath()[0] ?? e.target) as HTMLElement | null;
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
