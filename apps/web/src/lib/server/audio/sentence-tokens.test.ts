// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  interpolateSentenceMarks,
  type SentenceTokens,
} from './sentence-tokens.js';

const SENTENCES: SentenceTokens[] = [
  {
    sentenceIdx: 0,
    tokens: [
      { id: 't0', surface: 'hello', isWord: true },
      { id: 't1', surface: ' ', isWord: false },
      { id: 't2', surface: 'world', isWord: true },
      { id: 't3', surface: '.', isWord: false },
    ],
  },
  {
    sentenceIdx: 1,
    tokens: [
      { id: 't4', surface: 'next', isWord: true },
      { id: 't5', surface: '.', isWord: false },
    ],
  },
];

describe('interpolateSentenceMarks', () => {
  it('emits a row per word token, skipping punctuation', () => {
    const out = interpolateSentenceMarks(SENTENCES, [
      { sentenceIdx: 0, startMs: 0, endMs: 1000 },
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.tokenId)).toEqual(['t0', 't2']);
    expect(out[0]).toMatchObject({ startMs: 0, endMs: 500 });
    expect(out[1]).toMatchObject({ startMs: 500, endMs: 1000 });
  });

  it('skips a sentence that has no mark', () => {
    const out = interpolateSentenceMarks(SENTENCES, [
      { sentenceIdx: 1, startMs: 2000, endMs: 3000 },
    ]);
    expect(out.map((r) => r.tokenId)).toEqual(['t4']);
  });

  it('handles a degenerate sentence with no words', () => {
    const out = interpolateSentenceMarks(
      [{ sentenceIdx: 7, tokens: [{ id: 'x', surface: '.', isWord: false }] }],
      [{ sentenceIdx: 7, startMs: 0, endMs: 100 }],
    );
    expect(out).toEqual([]);
  });
});
