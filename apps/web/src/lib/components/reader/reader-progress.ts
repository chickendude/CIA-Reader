import type { ProgressAnchor } from './progress-client.js';
import type { ChapterView } from './types.js';

export type VisibleRect = {
  top: number;
  left: number;
  right: number;
  bottom: number;
};

const WORD_SELECTOR = '[data-token-id][data-token-idx], .word[data-token-idx]';

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
  return Math.max(0, Math.min(100, Math.round(((before + inChapter) / total) * 100)));
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
