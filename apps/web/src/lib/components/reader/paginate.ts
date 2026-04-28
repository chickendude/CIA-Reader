/**
 * Reader page-mode pagination helpers (T-5.23).
 *
 * Page mode renders the whole chapter into a fixed-size viewport and
 * slides between "pages" with a CSS transform. The helpers are
 * dimension-agnostic — they take a content size and a page size and
 * tell the component how many pages exist, where to clamp the active
 * index, and what translate offset matches the active index. The
 * component decides whether those numbers are widths (horizontal
 * pagination, the current default) or heights (the previous vertical
 * slice). Kept DOM-free so the maths can be unit-tested in isolation.
 */

export function pageCountFor(contentSize: number, pageSize: number): number {
  if (pageSize <= 0) return 1;
  if (contentSize <= 0) return 1;
  return Math.max(1, Math.ceil(contentSize / pageSize));
}

export function clampPage(idx: number, count: number): number {
  if (count <= 0) return 0;
  if (idx < 0) return 0;
  if (idx >= count) return count - 1;
  return idx;
}

export function pageOffset(idx: number, pageSize: number): number {
  if (pageSize <= 0) return 0;
  return Math.max(0, idx) * pageSize;
}
