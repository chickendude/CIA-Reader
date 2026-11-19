import { describe, expect, it, vi } from 'vitest';
import { estimateCoverage } from './book-comparison.js';

vi.mock('../db/index.js', () => ({}));

const rows = [
  { lemma: 'common', source: 80, target: 31 },
  { lemma: 'shared', source: 18, target: 9 },
  { lemma: 'rare', source: 1, target: 7 },
  { lemma: null, source: 1, target: 2 },
  { lemma: 'new', source: 0, target: 51 },
];

describe('book coverage estimates', () => {
  it('transfers the source frequency prefix, then learns the most frequent remaining target entries', () => {
    expect(estimateCoverage(rows, 98, 91)).toMatchObject({ coverage: 40, additionalWords: 1 });
    expect(estimateCoverage(rows, 98, 91.1)).toMatchObject({ coverage: 40, additionalWords: 2 });
  });

  it('counts whole entries when a source frequency crosses the threshold', () => {
    expect(estimateCoverage(rows, 80.1, 40)).toMatchObject({ coverage: 40, additionalWords: 0 });
    expect(estimateCoverage(rows, 0, 0)).toMatchObject({ coverage: 0, additionalWords: 0 });
  });

  it('includes unresolved occurrences in each denominator', () => {
    expect(estimateCoverage(rows, 100, 98)).toEqual({ kind: 'source-limit', maximum: 99 });
    expect(estimateCoverage(rows, 98, 100)).toMatchObject({ coverage: 40, additionalWords: null, maximum: 98 });
  });

  it('requires occurrences in both books', () => {
    expect(estimateCoverage([], 98, 98)).toEqual({ kind: 'unavailable' });
    expect(estimateCoverage([{ lemma: 'alone', source: 0, target: 3 }], 98, 98)).toEqual({ kind: 'unavailable' });
  });
});
