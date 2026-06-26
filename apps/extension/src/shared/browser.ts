/**
 * Cross-browser WebExtension API handle.
 *
 * Firefox exposes a promise-based `browser`; Chrome exposes `chrome` (which is
 * also promise-based for the MV3 APIs we use: storage, runtime messaging, tabs,
 * scripting). We prefer `browser` and fall back to `chrome` so the rest of the
 * codebase never branches on the host browser.
 *
 * `typeof browser` is safe even where the global is absent (Chrome): `typeof`
 * on an undeclared identifier yields the string "undefined" rather than throwing.
 */
declare const chrome: typeof browser | undefined;

export const ext: typeof browser =
  typeof browser !== 'undefined'
    ? browser
    : typeof chrome !== 'undefined'
      ? (chrome as unknown as typeof browser)
      : // Neither global exists (e.g. under vitest/node). `ext` is never
        // touched in that context — pure logic is tested via injected fakes.
        (undefined as unknown as typeof browser);
