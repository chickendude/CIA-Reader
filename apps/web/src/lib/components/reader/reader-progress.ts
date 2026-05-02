import type { ProgressAnchor } from './progress-client.js';
import type { ChapterView } from './types.js';

export type VisibleRect = {
  top: number;
  left: number;
  right: number;
  bottom: number;
};

export const WORD_SELECTOR = '[data-token-id][data-token-idx], .word[data-token-idx]';

function visibleSize(a: DOMRect, b: VisibleRect): { width: number; height: number } {
  return {
    width: Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)),
    height: Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)),
  };
}

export function viewportRect(topInset = 0): VisibleRect {
  const vv = window.visualViewport;
  const top = (vv?.offsetTop ?? 0) + topInset;
  const left = vv?.offsetLeft ?? 0;
  const width = vv?.width ?? window.innerWidth;
  const height = vv?.height ?? window.innerHeight;
  return {
    top,
    left,
    right: left + width,
    bottom: top + Math.max(0, height - topInset),
  };
}

export function readerTopInset(): number {
  if (typeof document === 'undefined') return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--reader-top-h').trim();
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

export function intersectRects(a: VisibleRect, b: VisibleRect): VisibleRect {
  return {
    top: Math.max(a.top, b.top),
    left: Math.max(a.left, b.left),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
}

export function rectFromElement(el: Element): VisibleRect {
  const rect = el.getBoundingClientRect();
  return {
    top: rect.top,
    left: rect.left,
    right: rect.right,
    bottom: rect.bottom,
  };
}

export function readableRect(root: HTMLElement, topInset = readerTopInset()): VisibleRect {
  return intersectRects(viewportRect(topInset), rectFromElement(root));
}

export function findFirstVisibleWordAnchor(
  root: ParentNode,
  args: {
    clip: VisibleRect;
    fallbackChapterIdx?: number;
    minVisiblePx?: number;
  },
): Pick<ProgressAnchor, 'chapterIdx' | 'tokenIdx'> | null {
  const minVisiblePx = args.minVisiblePx ?? 2;
  let best: {
    chapterIdx: number;
    tokenIdx: number;
    top: number;
    left: number;
  } | null = null;

  for (const el of Array.from(root.querySelectorAll<HTMLElement>(WORD_SELECTOR))) {
    const rawTokenIdx = el.dataset.tokenIdx;
    if (rawTokenIdx == null) continue;
    const tokenIdx = Number.parseInt(rawTokenIdx, 10);
    if (!Number.isFinite(tokenIdx)) continue;

    const rect = el.getBoundingClientRect();
    const visible = visibleSize(rect, args.clip);
    if (visible.width < minVisiblePx || visible.height < minVisiblePx) continue;

    const rawChapterIdx = el.closest<HTMLElement>('[data-chapter-idx]')?.dataset.chapterIdx;
    const chapterIdx =
      rawChapterIdx == null ? args.fallbackChapterIdx : Number.parseInt(rawChapterIdx, 10);
    if (chapterIdx == null || !Number.isFinite(chapterIdx)) continue;

    const top = Math.max(rect.top, args.clip.top);
    const left = Math.max(rect.left, args.clip.left);
    if (!best || top < best.top || (top === best.top && left < best.left)) {
      best = { chapterIdx, tokenIdx, top, left };
    }
  }

  return best ? { chapterIdx: best.chapterIdx, tokenIdx: best.tokenIdx } : null;
}

export function columnIndexForElement(el: Element, contentEl: Element, pageWidth: number): number {
  if (pageWidth <= 0) return 0;
  const firstRect = el.getClientRects()[0] ?? el.getBoundingClientRect();
  const contentRect = contentEl.getBoundingClientRect();
  const x = Math.max(0, firstRect.left - contentRect.left);
  return Math.max(0, Math.floor((x + 1) / pageWidth));
}

// Map of word elements to their column index, built once per measure
// cycle. Each `columnIndexForElement` call forces a layout flush via
// `getClientRects()`; on a chapter with thousands of word spans this
// dominates page-flip cost. `findFirstWordInColumn` recomputes the
// mapping for every call, so a single page flip used to flush layout
// O(n_tokens) times — twice, once for the current page and once for
// the next-page boundary. Build it once, reuse for both queries.
export interface PageWordIndex {
  pageWidth: number;
  contentWidth: number;
  fallbackChapterIdx: number;
  // Document-order entries — column index is monotonically
  // non-decreasing in left-to-right column flow, so consumers can
  // short-circuit once they pass the target column.
  entries: ReadonlyArray<{ chapterIdx: number; tokenIdx: number; columnIndex: number }>;
}

export function buildPageWordIndex(args: {
  root: ParentNode;
  contentEl: Element;
  pageWidth: number;
  contentWidth: number;
  fallbackChapterIdx: number;
}): PageWordIndex {
  const empty: PageWordIndex = {
    pageWidth: args.pageWidth,
    contentWidth: args.contentWidth,
    fallbackChapterIdx: args.fallbackChapterIdx,
    entries: [],
  };
  if (args.pageWidth <= 0) return empty;

  const contentRect = args.contentEl.getBoundingClientRect();
  const entries: Array<{ chapterIdx: number; tokenIdx: number; columnIndex: number }> = [];
  for (const el of Array.from(args.root.querySelectorAll<HTMLElement>(WORD_SELECTOR))) {
    const rawTokenIdx = el.dataset.tokenIdx;
    if (rawTokenIdx == null) continue;
    const tokenIdx = Number.parseInt(rawTokenIdx, 10);
    if (!Number.isFinite(tokenIdx)) continue;
    const rawChapterIdx = el.closest<HTMLElement>('[data-chapter-idx]')?.dataset.chapterIdx;
    const chapterIdx =
      rawChapterIdx == null ? args.fallbackChapterIdx : Number.parseInt(rawChapterIdx, 10);
    if (!Number.isFinite(chapterIdx)) continue;
    const firstRect = el.getClientRects()[0] ?? el.getBoundingClientRect();
    const x = Math.max(0, firstRect.left - contentRect.left);
    const columnIndex = Math.max(0, Math.floor((x + 1) / args.pageWidth));
    entries.push({ chapterIdx, tokenIdx, columnIndex });
  }
  return {
    pageWidth: args.pageWidth,
    contentWidth: args.contentWidth,
    fallbackChapterIdx: args.fallbackChapterIdx,
    entries,
  };
}

export function firstWordInColumnFromIndex(
  index: PageWordIndex,
  pageIdx: number,
): Pick<ProgressAnchor, 'chapterIdx' | 'tokenIdx'> | null {
  for (const e of index.entries) {
    if (e.columnIndex < pageIdx) continue;
    if (e.columnIndex > pageIdx) return null;
    return { chapterIdx: e.chapterIdx, tokenIdx: e.tokenIdx };
  }
  return null;
}

export function findFirstWordInColumn(
  root: ParentNode,
  args: {
    contentEl: Element;
    pageWidth: number;
    pageIdx: number;
    fallbackChapterIdx: number;
  },
): Pick<ProgressAnchor, 'chapterIdx' | 'tokenIdx'> | null {
  if (args.pageWidth <= 0) return null;
  let best: {
    chapterIdx: number;
    tokenIdx: number;
    top: number;
    left: number;
  } | null = null;

  for (const el of Array.from(root.querySelectorAll<HTMLElement>(WORD_SELECTOR))) {
    const rawTokenIdx = el.dataset.tokenIdx;
    if (rawTokenIdx == null) continue;
    const tokenIdx = Number.parseInt(rawTokenIdx, 10);
    if (!Number.isFinite(tokenIdx)) continue;
    if (columnIndexForElement(el, args.contentEl, args.pageWidth) !== args.pageIdx) {
      continue;
    }

    const rawChapterIdx = el.closest<HTMLElement>('[data-chapter-idx]')?.dataset.chapterIdx;
    const chapterIdx =
      rawChapterIdx == null ? args.fallbackChapterIdx : Number.parseInt(rawChapterIdx, 10);
    if (!Number.isFinite(chapterIdx)) continue;

    const rect = el.getClientRects()[0] ?? el.getBoundingClientRect();
    const top = rect.top;
    const left = rect.left;
    if (!best || top < best.top || (top === best.top && left < best.left)) {
      best = { chapterIdx, tokenIdx, top, left };
    }
  }

  return best ? { chapterIdx: best.chapterIdx, tokenIdx: best.tokenIdx } : null;
}

// Returns a float 0..100 with no rounding. Display sites should pass
// the result through `formatPct` / `formatPctRange` with a precision
// derived from `pctPrecisionFor(totalTokens)`. Persisted progress
// (`pct_read` column, `real`) keeps the full-precision value.
export function computePctRead(
  chapters: ChapterView[],
  chapterIdx: number,
  tokenIdx: number,
  opts: { completedText?: boolean } = {},
): number {
  if (opts.completedText) return 100;
  const total = chapters.reduce((sum, c) => sum + Math.max(0, c.tokenCount), 0);
  if (total <= 0) return 0;
  const before = chapters
    .slice(0, Math.max(0, chapterIdx))
    .reduce((sum, c) => sum + Math.max(0, c.tokenCount), 0);
  const currentCount = Math.max(0, chapters[chapterIdx]?.tokenCount ?? 0);
  const inChapter = Math.max(0, Math.min(tokenIdx, Math.max(0, currentCount - 1)));
  return Math.max(0, Math.min(100, ((before + inChapter) / total) * 100));
}

// Choose decimal precision for the progress display so flipping one
// page advances the number by ~1 unit. With ~200 words/page typical:
// short texts (< 5k tokens) get clean integers, mid-length (5k–50k)
// get one decimal, and long texts (50k+) get two so the bar isn't
// "stuck" at 4% for twenty page-flips.
export function pctPrecisionFor(totalTokens: number): 0 | 1 | 2 {
  const n = Math.max(0, Math.floor(totalTokens));
  if (n < 5_000) return 0;
  if (n < 50_000) return 1;
  return 2;
}

export function formatPct(pct: number, precision: 0 | 1 | 2): string {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  return `${clamped.toFixed(precision)}%`;
}

export function formatPctRange(startPct: number, endPct: number, precision: 0 | 1 | 2): string {
  const startStr = formatPct(startPct, precision);
  const endStr = formatPct(endPct, precision);
  return startStr === endStr ? endStr : `${startStr.replace(/%$/, '')}–${endStr}`;
}

// Resolve the anchor that represents the *end* of the user's reading
// position on the current page — i.e. the first token they have NOT
// yet read. Used to drive the displayed progress percentage so a page
// densely packed with 500 words advances the bar by 500/total, while
// a sparse page contributes proportionally less. Without this, a page
// reader anchored to the *first visible word* shows progress that
// reflects everything before the page but nothing within it, so
// dense pages register as a single tick the moment you flip past them.
//
// `currentAnchor` is the first visible word on the current page (kept
// for the resume position); `nextAnchor` is the first visible word on
// the page after, supplied by the caller from a second DOM scan. When
// the current page is the last in its chapter we roll over to the
// next chapter's first token; on the very last page of the very last
// chapter we mark the text completed.
export function pageBoundaryAnchor(args: {
  chapters: { tokenCount: number }[];
  chapterIdx: number;
  pageInChapter: number;
  pageCount: number;
  currentAnchor: { chapterIdx: number; tokenIdx: number };
  nextAnchor: { chapterIdx: number; tokenIdx: number } | null;
}): { chapterIdx: number; tokenIdx: number; completed: boolean } {
  const { chapters, chapterIdx, pageInChapter, pageCount, currentAnchor, nextAnchor } = args;
  const isLastPage = pageInChapter >= Math.max(0, pageCount - 1);
  const isLastChapter = chapterIdx >= chapters.length - 1;
  if (isLastPage && isLastChapter) {
    return { chapterIdx: currentAnchor.chapterIdx, tokenIdx: currentAnchor.tokenIdx, completed: true };
  }
  if (isLastPage) {
    return { chapterIdx: chapterIdx + 1, tokenIdx: 0, completed: false };
  }
  if (nextAnchor) {
    return { chapterIdx: nextAnchor.chapterIdx, tokenIdx: nextAnchor.tokenIdx, completed: false };
  }
  return { chapterIdx: currentAnchor.chapterIdx, tokenIdx: currentAnchor.tokenIdx, completed: false };
}

export function firstTokenPage<T extends { idx: number; isWord: boolean }>(
  pages: T[][][] | null,
  tokenIdx: number,
): number {
  if (!pages || pages.length === 0) return 0;
  const target = Math.max(0, tokenIdx);
  for (let i = 0; i < pages.length; i += 1) {
    const words = pages[i]!.flat().filter((t) => t.isWord);
    if (words.length === 0) continue;
    const last = words[words.length - 1]!.idx;
    if (target <= last) return i;
  }
  return pages.length - 1;
}

export function findTokenElementAtOrAfter(root: ParentNode, tokenIdx: number): HTMLElement | null {
  const target = Math.max(0, tokenIdx);
  let best: { el: HTMLElement; idx: number } | null = null;
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(WORD_SELECTOR))) {
    const raw = el.dataset.tokenIdx;
    if (raw == null) continue;
    const idx = Number.parseInt(raw, 10);
    if (!Number.isFinite(idx) || idx < target) continue;
    if (!best || idx < best.idx) best = { el, idx };
  }
  return best?.el ?? null;
}
