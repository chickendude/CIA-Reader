/**
 * Immersive reading mode (T-5.16).
 *
 * When the reader hides its chrome — the app shell rail on desktop,
 * the bottom tab bar on mobile, and the mobile top-strip — the
 * page sets `data-reader-immersive="1"` on `<html>`. AppShell.svelte's
 * CSS responds to that attribute. The flag is persisted in
 * `sessionStorage` so paging or chapter clicks within a reader visit
 * keep the chrome hidden, but it does NOT survive tab close (you
 * always start a fresh visit with the chrome showing).
 *
 * The helpers are pure DOM/storage so they're testable under jsdom
 * without rendering a Svelte component.
 */

export const IMMERSIVE_ATTR = 'data-reader-immersive';
export const IMMERSIVE_STORAGE_KEY = 'cia_reader_immersive';

/** Read the persisted immersive preference for this tab. Returns
 *  false in non-browser environments (SSR). */
export function readPersistedImmersive(): boolean {
  if (typeof sessionStorage === 'undefined') return false;
  try {
    return sessionStorage.getItem(IMMERSIVE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Write the immersive preference for this tab. */
export function writePersistedImmersive(on: boolean): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    if (on) sessionStorage.setItem(IMMERSIVE_STORAGE_KEY, '1');
    else sessionStorage.removeItem(IMMERSIVE_STORAGE_KEY);
  } catch {
    // Storage may be unavailable (private browsing on Safari, etc.) —
    // fall through silently. The attribute on <html> is still the
    // active source of truth for the current page paint.
  }
}

/** Apply the immersive flag to `<html>` so the shell's CSS responds. */
export function setImmersiveAttribute(on: boolean): void {
  if (typeof document === 'undefined') return;
  if (on) document.documentElement.setAttribute(IMMERSIVE_ATTR, '1');
  else document.documentElement.removeAttribute(IMMERSIVE_ATTR);
}

/** Read the current attribute state. */
export function isImmersiveAttributeSet(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.getAttribute(IMMERSIVE_ATTR) === '1';
}
