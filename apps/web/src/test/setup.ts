/**
 * Vitest setup file. Runs before each test file.
 *
 * jsdom shares ONE `localStorage` / `sessionStorage` across every test in a
 * file, so persisted UI preferences — the active reference-dictionary tab, the
 * hidden definition-language set, the reader's immersive flag — leak from one
 * test into the next. That makes order-dependent flakes: a test that selects
 * the English reference tab persists "en", and the next test that renders the
 * popup then defaults to English instead of Spanish. (It only bites where the
 * env exposes a working Storage; some jsdom builds no-op these calls, which is
 * why such flakes hide locally and only surface in CI.)
 *
 * Reset both stores before every test so each one starts from a clean slate.
 * Guarded — if Storage isn't available there's nothing to clear.
 */
import { beforeEach } from 'vitest';

beforeEach(() => {
  try {
    globalThis.localStorage?.clear();
  } catch {
    /* no working localStorage in this env — nothing to reset */
  }
  try {
    globalThis.sessionStorage?.clear();
  } catch {
    /* no working sessionStorage in this env — nothing to reset */
  }
});

export {};
