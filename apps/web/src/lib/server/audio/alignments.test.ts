// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { findAlignmentAt } from './alignments.js';

const FIXTURE = [
  { tokenId: 't0', startMs: 0, endMs: 200 },
  { tokenId: 't1', startMs: 200, endMs: 400 },
  { tokenId: 't2', startMs: 500, endMs: 700 }, // gap before
  { tokenId: 't3', startMs: 700, endMs: 900 },
];

describe('findAlignmentAt', () => {
  it('returns the index of the alignment covering currentMs', () => {
    expect(findAlignmentAt(FIXTURE, 100)).toBe(0);
    expect(findAlignmentAt(FIXTURE, 350)).toBe(1);
    expect(findAlignmentAt(FIXTURE, 600)).toBe(2);
  });

  it('matches the boundary timestamp on a containing range', () => {
    // 200 = endMs of t0 = startMs of t1; both contain it. Either
    // index is acceptable; we just want a stable, defined hit.
    const idx = findAlignmentAt(FIXTURE, 200);
    expect(idx === 0 || idx === 1).toBe(true);
  });

  it('falls back to the most recent alignment when in a gap', () => {
    // 450 falls between t1.endMs=400 and t2.startMs=500.
    expect(findAlignmentAt(FIXTURE, 450)).toBe(1);
  });

  it('returns null when current is before the first alignment', () => {
    expect(findAlignmentAt(FIXTURE, -10)).toBeNull();
  });

  it('returns the last alignment when current is past the end', () => {
    expect(findAlignmentAt(FIXTURE, 99999)).toBe(3);
  });

  it('returns null on an empty list', () => {
    expect(findAlignmentAt([], 100)).toBeNull();
  });
});
