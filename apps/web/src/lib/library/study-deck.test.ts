import { describe, expect, it } from 'vitest';
import { studyDeckPlan, type DeckOptions, type StudyBand } from './study-deck.js';

const options: DeckOptions = { scope: 'target', target: 98, ignoreProper: false, ignoreLoans: false };
function band(status: StudyBand['status'], frequency: number, entries = 1, proper = false, loan = false): StudyBand {
  return { status, frequency, entries, proper, loan };
}
const bands = [
  band('known', 30), band('learning', 20), band('unknown', 15, 1, true, true),
  band('unknown', 10, 1, false, true), band('unknown', 5, 4), band('unresolved', 5), band('ignored', 2),
];

describe('study deck selection', () => {
  it('starts with studied occurrences and takes only enough entries from the last frequency band', () => {
    expect(studyDeckPlan(bands, { ...options, target: 85 })).toEqual({ count: 4, total: 100, covered: 85, reached: true });
    expect(studyDeckPlan(bands, { ...options, target: 50 }).count).toBe(0);
  });

  it('can build a target deck from scratch including known and learning words', () => {
    expect(studyDeckPlan(bands, { ...options, target: 50, includeStudied: true }))
      .toEqual({ count: 2, total: 100, covered: 50, reached: true });
    expect(studyDeckPlan(bands, { ...options, includeStudied: true }))
      .toEqual({ count: 8, total: 100, covered: 95, reached: false });
  });

  it('removes ignored categories from both the deck and the denominator, counting overlap once', () => {
    expect(studyDeckPlan(bands, { ...options, target: 80, ignoreProper: true })).toEqual({ count: 3, total: 85, covered: 70, reached: true });
    expect(studyDeckPlan(bands, { ...options, target: 80, ignoreProper: true, ignoreLoans: true }))
      .toEqual({ count: 2, total: 75, covered: 60, reached: true });
  });

  it('reports unreachable targets, including an empty analysis', () => {
    expect(studyDeckPlan(bands, options)).toEqual({ count: 6, total: 100, covered: 95, reached: false });
    expect(studyDeckPlan([], options)).toEqual({ count: 0, total: 0, covered: 0, reached: false });
  });

  it('takes only the cards needed to reach a fractional coverage threshold', () => {
    const partial = [band('known', 1), band('unknown', .5, 2), band('unresolved', 1)];
    expect(studyDeckPlan(partial, { ...options, target: 50 }))
      .toEqual({ count: 1, total: 3, covered: 1.5, reached: true });
    expect(studyDeckPlan([band('known', .7), band('unknown', .1, 3)], { ...options, target: 100 }))
      .toMatchObject({ count: 3, reached: true });
  });

  it('keeps the existing export scopes and applies category filters to each', () => {
    expect(studyDeckPlan(bands, { ...options, scope: 'all' }).count).toBe(9);
    expect(studyDeckPlan(bands, { ...options, scope: 'unknown', ignoreLoans: true }).count).toBe(4);
    expect(studyDeckPlan(bands, { ...options, scope: 'unknown', includeStudied: true }).count).toBe(8);
    expect(studyDeckPlan(bands, { ...options, scope: 'learning' }).count).toBe(1);
  });
});
