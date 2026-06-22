/**
 * Client helpers for the language switcher (#436).
 *
 * Two endpoints back the switcher because the two actions differ:
 *   - switching to a language you already read only moves the cookie, and
 *     works for anonymous visitors too → PUT /api/v1/me/current-language;
 *   - adding a language mutates `user_languages`, so it needs auth and also
 *     sets the cookie (add + switch in one request) → POST /api/v1/me/languages.
 *
 * Both throw on a non-2xx response so callers can surface the error and
 * skip the follow-up reload / navigation.
 */

async function send(url: string, method: 'PUT' | 'POST', code: string): Promise<void> {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new Error(`${method} ${url} failed: ${res.status}`);
}

/** Move the current-language cookie. No DB write; safe for anonymous. */
export function switchCurrentLanguage(code: string): Promise<void> {
  return send('/api/v1/me/current-language', 'PUT', code);
}

/** Add the language to the signed-in user's list and switch to it. */
export function addLanguage(code: string): Promise<void> {
  return send('/api/v1/me/languages', 'POST', code);
}
