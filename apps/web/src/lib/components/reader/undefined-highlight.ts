/**
 * Admin "flag undefined words" reader overlay (#435).
 *
 * Admins can toggle a reader overlay that tints every word whose
 * lemma has no canonical definition yet, so dictionary gaps are easy
 * to spot while reading. The reader page sets
 * `data-flag-undefined="1"` on `<html>`; `tokens.css` only paints
 * `.word.no-definition` while that attribute is present, so the class
 * TokenSpan always emits stays inert for everyone else.
 *
 * Unlike immersive mode (sessionStorage, fresh each visit), the
 * preference lives in `localStorage`: an admin doing a
 * definition-coverage pass keeps the overlay on across visits until
 * they switch it off.
 *
 * The helpers are pure DOM/storage so they're testable under jsdom
 * without rendering a Svelte component.
 */

export const FLAG_UNDEFINED_ATTR = 'data-flag-undefined';
export const FLAG_UNDEFINED_STORAGE_KEY = 'cia_reader_flag_undefined';

/** Read the persisted overlay preference. Returns false in
 *  non-browser environments (SSR) or when storage is unavailable. */
export function readPersistedFlagUndefined(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(FLAG_UNDEFINED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Persist the overlay preference. */
export function writePersistedFlagUndefined(on: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (on) localStorage.setItem(FLAG_UNDEFINED_STORAGE_KEY, '1');
    else localStorage.removeItem(FLAG_UNDEFINED_STORAGE_KEY);
  } catch {
    // Storage may be unavailable (private browsing on Safari, etc.) —
    // fall through silently. The attribute on <html> is still the
    // active source of truth for the current page paint.
  }
}

/** Apply the overlay flag to `<html>` so the token CSS responds. */
export function setFlagUndefinedAttribute(on: boolean): void {
  if (typeof document === 'undefined') return;
  if (on) document.documentElement.setAttribute(FLAG_UNDEFINED_ATTR, '1');
  else document.documentElement.removeAttribute(FLAG_UNDEFINED_ATTR);
}

/** Read the current attribute state. */
export function isFlagUndefinedAttributeSet(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.getAttribute(FLAG_UNDEFINED_ATTR) === '1';
}
