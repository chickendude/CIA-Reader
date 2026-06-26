/**
 * Background worker — the privileged hub.
 *
 * Owns the auth token, the local dictionary cache, external-dictionary fetches,
 * and AnkiConnect I/O. The content script and the popup/options pages talk to it
 * via typed messages (see shared/messages). For now it answers PING and a stub
 * auth status; real auth lands with the token client.
 */
import { ext } from '../shared/browser';
import type { Message } from '../shared/messages';
import { authStatus, login, logout } from './auth';
import { localDictionary } from './dictionary-local';
import { episodeKey } from '../shared/episode';
import { addAnkiNote, ankiNoteExists } from './anki';
import { frequencyIndex } from './frequency';
import { lookupWord } from './lookup';
import { referenceCache } from './reference';
import { fetchSubtitles } from './subtitles';
import { cuesCache } from './subtitles-cache';
import { translationCache } from './translation';

async function handle(msg: Message, sender: browser.runtime.MessageSender): Promise<unknown> {
  switch (msg.type) {
    case 'PING':
      return { pong: true };
    case 'AUTH_STATUS':
      return authStatus();
    case 'LOGIN':
      return login(msg.email, msg.password);
    case 'LOGOUT':
      await logout();
      return { loggedIn: false };
    case 'DICT_STATUS':
      return localDictionary.status(msg.language);
    case 'DICT_REFRESH':
      return { ready: true, count: await localDictionary.refresh(msg.language) };
    case 'FETCH_SUBTITLES':
      return { cues: await fetchSubtitles(msg.url) };
    case 'LOOKUP':
      return lookupWord(msg.language, msg.surface, undefined, msg.lemma);
    case 'REFERENCE':
      return { results: await referenceCache.lookup(msg.language, msg.word) };
    case 'CUES_FOR_URL':
      return { cues: await cuesCache.get(episodeKey(msg.url)) };
    case 'FREQUENCY':
      return {
        count: await frequencyIndex.count(msg.language, episodeKey(msg.url), msg.lemma, msg.surface),
      };
    case 'ADD_ANKI':
      return addAnkiNote(msg);
    case 'ANKI_HAS':
      return { exists: await ankiNoteExists(msg.front) };
    case 'DICT_SUGGEST':
      return { headwords: await localDictionary.suggest(msg.language, msg.prefix) };
    case 'TRANSLATE':
      return {
        translation: await translationCache.translate(
          msg.language,
          msg.text,
          msg.targetLanguage,
          msg.cachedOnly,
        ),
      };
    case 'CAPTURE_SCREENSHOT': {
      try {
        const opts = { format: 'jpeg', quality: 80 } as const;
        const windowId = sender.tab?.windowId;
        const dataUrl =
          windowId === undefined
            ? await ext.tabs.captureVisibleTab(opts)
            : await ext.tabs.captureVisibleTab(windowId, opts);
        return { dataUrl };
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        console.warn('[primeran-miner] captureVisibleTab failed:', error);
        return { dataUrl: null, error };
      }
    }
    default:
      throw new Error(`Unknown message type: ${(msg as { type: string }).type}`);
  }
}

// Discover the subtitle .vtt by observing network requests (never touches the
// page's fetch/XHR — that would risk breaking the DRM media pipeline). When one
// is seen, fetch + parse it and push the cues to that tab's content script.
const sentByTab = new Map<number, string>();

ext.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId < 0 || !/\.vtt(\?|#|$)/i.test(details.url)) return;
    if (sentByTab.get(details.tabId) === details.url) return;
    void (async () => {
      try {
        const cues = await fetchSubtitles(details.url);
        sentByTab.set(details.tabId, details.url);
        try {
          const tab = await ext.tabs.get(details.tabId);
          if (tab?.url) {
            const episode = episodeKey(tab.url);
            await cuesCache.set(episode, cues);
            // Warm the per-episode frequency index in the background.
            void frequencyIndex.ensure('eu', episode);
          }
        } catch {
          /* tab gone / no url — caching is best-effort */
        }
        await ext.tabs.sendMessage(details.tabId, {
          type: 'SUBTITLES_LOADED',
          url: details.url,
          cues,
        });
      } catch (e) {
        console.warn('[primeran-miner] subtitle fetch/push failed', e);
      }
    })();
  },
  { urls: ['https://*.primeran.eus/*'] },
);

ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handle(message as Message, sender).then(
    (result) => sendResponse(result),
    // `__error` (not `error`) so a thrown handler is distinguishable from a
    // handler that legitimately returns an `error` field (e.g. login failure).
    (err: unknown) => sendResponse({ __error: err instanceof Error ? err.message : String(err) }),
  );
  // Returning true keeps the message channel open for the async sendResponse,
  // which is the cross-browser-safe way to reply asynchronously.
  return true;
});

console.info('[primeran-miner] background ready');
