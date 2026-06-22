/**
 * Reader chapter table-of-contents model.
 *
 * The reader presents one of two physical chapter layouts behind a
 * single chapter-selector dropdown:
 *
 *   - **in-text**: a multi-chapter `texts` row (paste / .txt auto-split).
 *     All chapter titles + token counts ship in `data.chapters`;
 *     navigation flips `?chapter=N` on the same text.
 *   - **collection**: a chapter-book — each chapter is its own
 *     one-chapter `texts` row inside a collection. The sibling list
 *     (title + summed tokenCount) comes from `readerCollectionContext`;
 *     navigation loads a different `textId`.
 *
 * `buildReaderToc` flattens both into a uniform entry list the
 * `ChapterNav` component renders, and exposes the whole-book word
 * totals the page footer needs to show progress across the *book*
 * rather than the loaded chapter. A standalone single-chapter text
 * yields a single entry (the component then hides the dropdown/arrows).
 *
 * Pure + framework-free so it carries unit coverage; the `.svelte`
 * component and `+page.*` route files are excluded from the gate.
 */

export type ReaderLayoutMode = 'page' | 'paged_scroll' | 'continuous';

export type ReaderTocEntry = {
  /** Stable key for `{#each}` (textId for collections, `ch-N` otherwise). */
  key: string;
  /** 1-based display number. */
  number: number;
  title: string;
  /** Word (token) count for this chapter. */
  words: number;
  /** Navigation target — always preserves the current reader `mode`. */
  href: string;
  isCurrent: boolean;
};

export type ReaderToc = {
  entries: ReaderTocEntry[];
  /** Index into `entries` of the current chapter, or -1. */
  currentIndex: number;
  total: number;
  /** Words in the whole book before the loaded text's first chapter.
   *  0 for in-text / single (the page reader uses its own totals). */
  bookWordsBefore: number;
  /** Whole-book word total. 0 for in-text / single. */
  bookWordsTotal: number;
  kind: 'collection' | 'in-text' | 'single';
};

export type ReaderTocInput = {
  textId: string;
  mode: ReaderLayoutMode;
  /** The loaded text's own chapters (every entry carries idx + title +
   *  tokenCount; only the active one carries body/tokens). */
  chapters: Array<{ idx: number; title: string | null; tokenCount: number }>;
  /** 0-based index of the active chapter within `chapters`. */
  currentChapterIdx: number;
  /** Collection sibling list when the text is part of a collection. */
  collection: {
    chapters: Array<{
      textId: string;
      position: number;
      title: string;
      tokenCount: number;
    }>;
    position: number;
  } | null;
};

function clampInt(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

export function buildReaderToc(input: ReaderTocInput): ReaderToc {
  const mode = input.mode;

  // --- Collection (chapter-book): siblings drive the TOC + book totals.
  if (input.collection && input.collection.chapters.length > 0) {
    const ordered = input.collection.chapters;
    const entries: ReaderTocEntry[] = ordered.map((c, i) => ({
      key: c.textId,
      number: i + 1,
      title: c.title?.trim() || 'Untitled',
      words: clampInt(c.tokenCount),
      href: `/reader/${c.textId}?mode=${mode}`,
      isCurrent: c.position === input.collection!.position,
    }));
    let currentIndex = entries.findIndex((e) => e.isCurrent);
    if (currentIndex < 0) currentIndex = 0;
    const bookWordsBefore = ordered
      .filter((c) => c.position < input.collection!.position)
      .reduce((sum, c) => sum + clampInt(c.tokenCount), 0);
    const bookWordsTotal = ordered.reduce(
      (sum, c) => sum + clampInt(c.tokenCount),
      0,
    );
    return {
      entries,
      currentIndex,
      total: entries.length,
      bookWordsBefore,
      bookWordsTotal,
      kind: 'collection',
    };
  }

  // --- In-text multi-chapter: data.chapters already has everything.
  const chapters = input.chapters;
  const entries: ReaderTocEntry[] = chapters.map((c) => ({
    key: `ch-${c.idx}`,
    number: c.idx + 1,
    title: c.title?.trim() || `Chapter ${c.idx + 1}`,
    words: clampInt(c.tokenCount),
    href: `/reader/${input.textId}?mode=${mode}&chapter=${c.idx}`,
    isCurrent: c.idx === input.currentChapterIdx,
  }));
  let currentIndex = entries.findIndex((e) => e.isCurrent);
  if (currentIndex < 0) currentIndex = 0;

  return {
    entries,
    currentIndex,
    total: entries.length,
    // In-text / single: the page reader already sums its own chapters,
    // so signal "use your own totals" with zeroes.
    bookWordsBefore: 0,
    bookWordsTotal: 0,
    kind: chapters.length > 1 ? 'in-text' : 'single',
  };
}
