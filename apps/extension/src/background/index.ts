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
import { fetchSubtitles } from './subtitles';

async function handle(msg: Message): Promise<unknown> {
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
    default:
      throw new Error(`Unknown message type: ${(msg as { type: string }).type}`);
  }
}

ext.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handle(message as Message).then(
    (result) => sendResponse(result),
    (err: unknown) => sendResponse({ error: err instanceof Error ? err.message : String(err) }),
  );
  // Returning true keeps the message channel open for the async sendResponse,
  // which is the cross-browser-safe way to reply asynchronously.
  return true;
});

console.info('[primeran-miner] background ready');
