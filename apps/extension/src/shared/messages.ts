/**
 * Typed message contract between the content script / popup / options pages and
 * the background worker. The background owns the auth token and all network +
 * Anki I/O, so every privileged action flows through here as a request/response.
 *
 * `Requests` maps a message type to its request payload and response shape; add
 * a row to extend the protocol and both ends stay type-checked.
 */
import { ext } from './browser';
import type { SubtitleCue } from './subtitles';
import type { LookupResult } from './lookup';

export type Requests = {
  PING: { req: Record<string, never>; res: { pong: true } };
  AUTH_STATUS: { req: Record<string, never>; res: { loggedIn: boolean; email?: string } };
  LOGIN: {
    req: { email: string; password: string };
    res: { loggedIn: boolean; email?: string; error?: string };
  };
  LOGOUT: { req: Record<string, never>; res: { loggedIn: false } };
  DICT_STATUS: { req: { language: string }; res: { ready: boolean; count: number } };
  DICT_REFRESH: { req: { language: string }; res: { ready: true; count: number } };
  FETCH_SUBTITLES: { req: { url: string }; res: { cues: SubtitleCue[] } };
  LOOKUP: { req: { language: string; surface: string }; res: LookupResult };
};

export type MessageType = keyof Requests;
/** Distributed (discriminated) union so a `switch (msg.type)` narrows the payload. */
export type Message = { [T in MessageType]: { type: T } & Requests[T]['req'] }[MessageType];
export type Response<T extends MessageType> = Requests[T]['res'];

/** Send a typed message to the background worker and await its response. A
 *  handler that threw comes back as `{ __error }`; rethrow it so callers'
 *  try/catch works. */
export async function sendMessage<T extends MessageType>(
  type: T,
  payload: Requests[T]['req'] = {} as Requests[T]['req'],
): Promise<Response<T>> {
  const res = await ext.runtime.sendMessage({ type, ...payload });
  if (res && typeof res === 'object' && '__error' in res) {
    throw new Error(String((res as { __error: unknown }).__error));
  }
  return res as Response<T>;
}
