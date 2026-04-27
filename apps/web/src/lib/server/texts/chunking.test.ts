import { describe, expect, it } from 'vitest';

import {
  CHUNK_THRESHOLD_TOKENS,
  estimateTokenCount,
  splitIntoChapters,
  TARGET_CHAPTER_TOKENS,
} from './chunking.js';

function manyParagraphs(count: number, wordsEach: number, prefix = 'p'): string {
  const para = Array.from({ length: wordsEach }, (_, i) => `${prefix}${i}`).join(' ');
  return Array.from({ length: count }, () => para).join('\n\n');
}

describe('estimateTokenCount', () => {
  it('counts whitespace-separated tokens', () => {
    expect(estimateTokenCount('one two three')).toBe(3);
    expect(estimateTokenCount(' one\ntwo\tthree ')).toBe(3);
  });
  it('returns 0 on whitespace-only', () => {
    expect(estimateTokenCount('   ')).toBe(0);
    expect(estimateTokenCount('')).toBe(0);
  });
});

describe('splitIntoChapters — short bodies', () => {
  it('returns one chapter for a body well under the threshold', () => {
    const drafts = splitIntoChapters('one two three\n\nfour five six');
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.idx).toBe(0);
    expect(drafts[0]!.title).toBeNull();
    expect(drafts[0]!.tokenCount).toBe(6);
  });

  it('strips leading/trailing whitespace from the single-chapter body', () => {
    const drafts = splitIntoChapters('   hello   ');
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.body).toBe('hello');
  });
});

describe('splitIntoChapters — explicit delimiters', () => {
  it('splits on form-feed', () => {
    const body = ['Chapter one body.', '\f', 'Chapter two body.'].join('\n');
    const drafts = splitIntoChapters(body);
    expect(drafts).toHaveLength(2);
    expect(drafts[0]!.body).toBe('Chapter one body.');
    expect(drafts[1]!.body).toBe('Chapter two body.');
  });

  it('splits on lines of three or more dashes', () => {
    const body = ['Chapter one body.', '---', 'Chapter two body.', '----', 'Chapter three.'].join(
      '\n',
    );
    const drafts = splitIntoChapters(body);
    expect(drafts).toHaveLength(3);
    expect(drafts.map((d) => d.body)).toEqual([
      'Chapter one body.',
      'Chapter two body.',
      'Chapter three.',
    ]);
  });

  it('extracts a leading "# Title" line as the chapter title', () => {
    const body = ['# Opening', 'First chapter body.', '---', '# Climax', 'Second body.'].join(
      '\n',
    );
    const drafts = splitIntoChapters(body);
    expect(drafts).toHaveLength(2);
    expect(drafts[0]!.title).toBe('Opening');
    expect(drafts[0]!.body).toBe('First chapter body.');
    expect(drafts[1]!.title).toBe('Climax');
    expect(drafts[1]!.body).toBe('Second body.');
  });

  it('skips empty sections from doubled delimiters', () => {
    const body = 'Chapter one body.\n---\n---\nChapter two body.';
    const drafts = splitIntoChapters(body);
    expect(drafts).toHaveLength(2);
    expect(drafts.map((d) => d.body)).toEqual([
      'Chapter one body.',
      'Chapter two body.',
    ]);
  });

  it('honors explicit delimiters even when the body is below threshold', () => {
    const body = 'tiny one.\n---\ntiny two.';
    const drafts = splitIntoChapters(body, { thresholdTokens: 10_000_000 });
    expect(drafts).toHaveLength(2);
  });

  it('falls back to a single chapter when delimiters produce no real content', () => {
    // A trailing delimiter with no body after it shouldn't strip the
    // preceding text — the original body should still survive.
    const drafts = splitIntoChapters('---\n');
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.body).toBe('---');
  });
});

describe('splitIntoChapters — auto-split by paragraph', () => {
  it('does NOT auto-split a body just under the threshold', () => {
    // 100 paragraphs × 50 tokens = 5_000 tokens — under default threshold.
    const body = manyParagraphs(100, 50);
    const drafts = splitIntoChapters(body);
    expect(drafts).toHaveLength(1);
  });

  it('auto-splits a body over the threshold into multiple chapters at paragraph boundaries', () => {
    // 8 paragraphs × 200 tokens = 1_600 tokens. Force chunking with a
    // small threshold + target so we can assert the boundaries land
    // between paragraphs.
    const body = manyParagraphs(8, 200);
    const drafts = splitIntoChapters(body, {
      thresholdTokens: 500,
      targetChapterTokens: 500,
    });
    expect(drafts.length).toBeGreaterThan(1);
    // No chapter should have a partial paragraph mid-string.
    for (const d of drafts) {
      // Each paragraph in the synthesised body looks like "p0 p1 ... p199".
      // After splitting, each chapter's body should still be made of
      // those whole paragraphs.
      const paragraphs = d.body.split(/\n{2,}/).map((p) => p.trim());
      for (const p of paragraphs) {
        const tokens = p.split(/\s+/);
        // Every paragraph has 200 tokens of the form "p0 p1 .. p199".
        expect(tokens.length).toBe(200);
        expect(tokens[0]).toBe('p0');
        expect(tokens[tokens.length - 1]).toBe('p199');
      }
    }
  });

  it('keeps one oversized paragraph as its own chapter rather than splitting mid-paragraph', () => {
    const big = Array.from({ length: 1000 }, (_, i) => `w${i}`).join(' ');
    const body = `tiny first paragraph.\n\n${big}\n\ntiny third.`;
    const drafts = splitIntoChapters(body, {
      thresholdTokens: 100,
      targetChapterTokens: 100,
    });
    // First chapter: tiny first. Big paragraph: own chapter. Third: own.
    expect(drafts.length).toBeGreaterThanOrEqual(2);
    const big_chapter = drafts.find((d) => d.tokenCount >= 1000);
    expect(big_chapter).toBeDefined();
  });

  it('numbers chapter idx contiguously starting at 0', () => {
    const body = manyParagraphs(20, 100);
    const drafts = splitIntoChapters(body, {
      thresholdTokens: 200,
      targetChapterTokens: 200,
    });
    expect(drafts.map((d) => d.idx)).toEqual(
      Array.from({ length: drafts.length }, (_, i) => i),
    );
  });
});

describe('default thresholds', () => {
  it('CHUNK_THRESHOLD_TOKENS is comfortably larger than TARGET_CHAPTER_TOKENS', () => {
    expect(CHUNK_THRESHOLD_TOKENS).toBeGreaterThan(TARGET_CHAPTER_TOKENS * 2);
  });
});
