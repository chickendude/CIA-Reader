/**
 * Reader page-mode pagination helpers (T-5.23).
 *
 * The page mode renders the whole chapter into a fixed-height
 * viewport and slides between "pages" with a CSS transform. Pure
 * helpers that the component composes:
 *   - `pageCountFor(contentH, viewportH)` — how many pages a chapter
 *     splits into.
 *   - `clampPage(idx, count)` — keep the active page index in range.
 *   - `pageOffset(idx, viewportH)` — the translateY offset for a
 *     given page.
 *
 * Kept pure / DOM-free so the maths is unit-tested without rendering.
 */

export function pageCountFor(contentH: number, viewportH: number): number {
  if (viewportH <= 0) return 1;
  if (contentH <= 0) return 1;
  return Math.max(1, Math.ceil(contentH / viewportH));
}

export function clampPage(idx: number, count: number): number {
  if (count <= 0) return 0;
  if (idx < 0) return 0;
  if (idx >= count) return count - 1;
  return idx;
}

export function pageOffset(idx: number, viewportH: number): number {
  if (viewportH <= 0) return 0;
  return Math.max(0, idx) * viewportH;
}
