/**
 * Switching languages updates a cookie and also works when signed out. Adding a language saves it
 * to the reader's account and selects it in the same request.
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
