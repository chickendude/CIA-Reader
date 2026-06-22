import { describe, expect, it } from 'vitest';

import { buildReaderToc, type ReaderTocInput } from './reader-toc.js';

const baseInput: ReaderTocInput = {
  textId: 'text-1',
  mode: 'page',
  chapters: [{ idx: 0, title: 'Only', tokenCount: 500 }],
  currentChapterIdx: 0,
  collection: null,
};

describe('buildReaderToc — in-text multi-chapter', () => {
  const input: ReaderTocInput = {
    ...baseInput,
    chapters: [
      { idx: 0, title: 'Intro', tokenCount: 100 },
      { idx: 1, title: '  ', tokenCount: 200 }, // blank → fallback
      { idx: 2, title: 'End', tokenCount: 300 },
    ],
    currentChapterIdx: 1,
  };

  it('builds one entry per chapter with ?chapter= hrefs preserving mode', () => {
    const toc = buildReaderToc({ ...input, mode: 'continuous' });
    expect(toc.kind).toBe('in-text');
    expect(toc.total).toBe(3);
    expect(toc.entries.map((e) => e.href)).toEqual([
      '/reader/text-1?mode=continuous&chapter=0',
      '/reader/text-1?mode=continuous&chapter=1',
      '/reader/text-1?mode=continuous&chapter=2',
    ]);
  });

  it('numbers chapters from 1 and falls back to "Chapter N" for blank titles', () => {
    const toc = buildReaderToc(input);
    expect(toc.entries.map((e) => `${e.number}:${e.title}`)).toEqual([
      '1:Intro',
      '2:Chapter 2',
      '3:End',
    ]);
  });

  it('marks the active chapter current and reports its index', () => {
    const toc = buildReaderToc(input);
    expect(toc.currentIndex).toBe(1);
    expect(toc.entries[1]!.isCurrent).toBe(true);
    expect(toc.entries.filter((e) => e.isCurrent)).toHaveLength(1);
  });

  it('leaves book totals zero so the page reader uses its own sums', () => {
    const toc = buildReaderToc(input);
    expect(toc.bookWordsBefore).toBe(0);
    expect(toc.bookWordsTotal).toBe(0);
  });
});

describe('buildReaderToc — chapter-book collection', () => {
  const input: ReaderTocInput = {
    ...baseInput,
    textId: 'text-b', // the loaded one-chapter text
    chapters: [{ idx: 0, title: 'Chapter Two', tokenCount: 200 }],
    currentChapterIdx: 0,
    collection: {
      position: 1,
      chapters: [
        { textId: 'text-a', position: 0, title: 'One', tokenCount: 100 },
        { textId: 'text-b', position: 1, title: 'Two', tokenCount: 200 },
        { textId: 'text-c', position: 2, title: 'Three', tokenCount: 300 },
      ],
    },
  };

  it('builds entries from siblings with /reader/<textId> hrefs preserving mode', () => {
    const toc = buildReaderToc(input);
    expect(toc.kind).toBe('collection');
    expect(toc.total).toBe(3);
    expect(toc.entries.map((e) => e.href)).toEqual([
      '/reader/text-a?mode=page',
      '/reader/text-b?mode=page',
      '/reader/text-c?mode=page',
    ]);
  });

  it('marks the current sibling by position, not the loaded chapter idx', () => {
    const toc = buildReaderToc(input);
    expect(toc.currentIndex).toBe(1);
    expect(toc.entries[1]!.key).toBe('text-b');
    expect(toc.entries[1]!.isCurrent).toBe(true);
  });

  it('computes whole-book totals (words before + grand total)', () => {
    const toc = buildReaderToc(input);
    expect(toc.bookWordsBefore).toBe(100); // text-a only
    expect(toc.bookWordsTotal).toBe(600); // 100 + 200 + 300
  });

  it('falls back to "Untitled" for blank sibling titles', () => {
    const toc = buildReaderToc({
      ...input,
      collection: {
        position: 0,
        chapters: [
          { textId: 'text-a', position: 0, title: '', tokenCount: 0 },
        ],
      },
    });
    expect(toc.entries[0]!.title).toBe('Untitled');
  });
});

describe('buildReaderToc — single standalone chapter', () => {
  it('yields a single entry and zero book totals', () => {
    const toc = buildReaderToc(baseInput);
    expect(toc.kind).toBe('single');
    expect(toc.total).toBe(1);
    expect(toc.currentIndex).toBe(0);
    expect(toc.bookWordsTotal).toBe(0);
  });
});
