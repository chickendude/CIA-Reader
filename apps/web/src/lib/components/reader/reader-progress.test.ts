import { describe, expect, it } from 'vitest';

import {
  columnIndexForElement,
  computePctRead,
  findFirstVisibleWordAnchor,
  findFirstWordInColumn,
  findTokenElementAtOrAfter,
  firstTokenPage,
} from './reader-progress.js';
import type { ChapterView } from './types.js';

function rect(top: number, left: number, bottom: number, right: number): DOMRect {
  return {
    top,
    left,
    bottom,
    right,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    toJSON: () => ({}),
  } as DOMRect;
}

function word(idx: number, bounds: DOMRect, attrs: { tokenId?: string } = {}): HTMLElement {
  const el = document.createElement('span');
  el.className = 'word';
  el.dataset.tokenIdx = String(idx);
  if (attrs.tokenId) el.dataset.tokenId = attrs.tokenId;
  el.getBoundingClientRect = () => bounds;
  return el;
}

describe('reader progress helpers', () => {
  it('finds the first visible word inside the clipped reading area', () => {
    const root = document.createElement('section');
    root.dataset.chapterIdx = '2';
    root.append(
      word(1, rect(20, -200, 40, -160)),
      word(2, rect(-20, 10, 10, 60)),
      word(3, rect(12, 10, 34, 60)),
    );

    expect(
      findFirstVisibleWordAnchor(root, {
        clip: { top: 0, left: 0, right: 300, bottom: 500 },
      }),
    ).toEqual({ chapterIdx: 2, tokenIdx: 2 });
  });

  it('uses the fallback chapter when tokens are rendered outside chapter sections', () => {
    const root = document.createElement('article');
    root.append(word(7, rect(10, 10, 20, 80)));

    expect(
      findFirstVisibleWordAnchor(root, {
        clip: { top: 0, left: 0, right: 300, bottom: 500 },
        fallbackChapterIdx: 4,
      }),
    ).toEqual({ chapterIdx: 4, tokenIdx: 7 });
  });

  it('ignores tiny clipped edge slivers when finding the first visible word', () => {
    const root = document.createElement('section');
    root.dataset.chapterIdx = '1';
    root.append(word(4, rect(0, 0, 100, 1)), word(5, rect(20, 10, 40, 80)));

    expect(
      findFirstVisibleWordAnchor(root, {
        clip: { top: 0, left: 0, right: 300, bottom: 500 },
        minVisiblePx: 4,
      }),
    ).toEqual({ chapterIdx: 1, tokenIdx: 5 });
  });

  it('finds the nearest rendered word at or after a saved token index', () => {
    const root = document.createElement('article');
    const before = word(3, rect(0, 0, 1, 1));
    const exact = word(8, rect(0, 0, 1, 1));
    const after = word(12, rect(0, 0, 1, 1));
    root.append(before, after, exact);

    expect(findTokenElementAtOrAfter(root, 8)).toBe(exact);
    expect(findTokenElementAtOrAfter(root, 9)).toBe(after);
  });

  it('computes a token element column from its first rendered rect', () => {
    const content = document.createElement('div');
    const el = document.createElement('span');
    content.getBoundingClientRect = () => rect(0, 20, 400, 420);
    el.getClientRects = () =>
      ({
        0: rect(20, 625, 40, 700),
        length: 1,
        item: (idx: number) => (idx === 0 ? rect(20, 625, 40, 700) : null),
        [Symbol.iterator]: function* () {
          yield rect(20, 625, 40, 700);
        },
      }) as DOMRectList;

    expect(columnIndexForElement(el, content, 300)).toBe(2);
  });

  it('finds the first word in a paginated column without relying on transform visibility', () => {
    const content = document.createElement('div');
    content.getBoundingClientRect = () => rect(0, 20, 400, 420);
    const first = word(8, rect(40, 330, 60, 380), { tokenId: 'a' });
    const second = word(12, rect(20, 625, 40, 700), { tokenId: 'b' });
    const third = word(13, rect(80, 625, 100, 700), { tokenId: 'c' });
    first.getClientRects = () =>
      ({
        0: rect(40, 330, 60, 380),
        length: 1,
        item: (idx: number) => (idx === 0 ? rect(40, 330, 60, 380) : null),
        [Symbol.iterator]: function* () {
          yield rect(40, 330, 60, 380);
        },
      }) as DOMRectList;
    second.getClientRects = () =>
      ({
        0: rect(20, 625, 40, 700),
        length: 1,
        item: (idx: number) => (idx === 0 ? rect(20, 625, 40, 700) : null),
        [Symbol.iterator]: function* () {
          yield rect(20, 625, 40, 700);
        },
      }) as DOMRectList;
    third.getClientRects = () =>
      ({
        0: rect(80, 625, 100, 700),
        length: 1,
        item: (idx: number) => (idx === 0 ? rect(80, 625, 100, 700) : null),
        [Symbol.iterator]: function* () {
          yield rect(80, 625, 100, 700);
        },
      }) as DOMRectList;
    content.append(first, third, second);

    expect(
      findFirstWordInColumn(content, {
        contentEl: content,
        pageWidth: 300,
        pageIdx: 2,
        fallbackChapterIdx: 3,
      }),
    ).toEqual({ chapterIdx: 3, tokenIdx: 12 });
  });

  it('maps a saved token to the first paged-scroll page that contains it', () => {
    const pages = [
      [[{ idx: 2, isWord: true }], [{ idx: 5, isWord: true }]],
      [[{ idx: 9, isWord: true }], [{ idx: 13, isWord: true }]],
    ];

    expect(firstTokenPage(pages, 0)).toBe(0);
    expect(firstTokenPage(pages, 6)).toBe(1);
    expect(firstTokenPage(pages, 99)).toBe(1);
  });

  it('computes pctRead from token position and preserves explicit completion', () => {
    const chapters = [
      { idx: 0, tokenCount: 10 },
      { idx: 1, tokenCount: 30 },
    ] as ChapterView[];

    expect(computePctRead(chapters, 1, 10)).toBe(50);
    expect(computePctRead(chapters, 1, 10, { completedText: true })).toBe(100);
  });
});
