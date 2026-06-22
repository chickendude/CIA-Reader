// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { maxImagePaintCoverage } from './render-client';

// pdf.js Util.transform: m1 × m2 over [a,b,c,d,e,f] affine matrices.
function transform(m1: number[], m2: number[]): number[] {
  return [
    m1[0]! * m2[0]! + m1[2]! * m2[1]!,
    m1[1]! * m2[0]! + m1[3]! * m2[1]!,
    m1[0]! * m2[2]! + m1[2]! * m2[3]!,
    m1[1]! * m2[2]! + m1[3]! * m2[3]!,
    m1[0]! * m2[4]! + m1[2]! * m2[5]! + m1[4]!,
    m1[1]! * m2[4]! + m1[3]! * m2[5]! + m1[5]!,
  ];
}

const CODES = { save: 10, restore: 11, transform: 12, image: [20, 21] };
const PAGE_W = 600;
const PAGE_H = 800;

function coverage(fnArray: number[], argsArray: unknown[]): number {
  return maxImagePaintCoverage(fnArray, argsArray, CODES, transform, PAGE_W, PAGE_H);
}

describe('maxImagePaintCoverage', () => {
  it('reports ~full coverage for a page-sized image (a scan)', () => {
    // scale CTM to the whole page, then paint the image.
    const cov = coverage([12, 20], [[PAGE_W, 0, 0, PAGE_H, 0, 0], null]);
    expect(cov).toBeCloseTo(1, 5);
  });

  it('reports small coverage for a small inline image', () => {
    const cov = coverage([12, 21], [[60, 0, 0, 80, 0, 0], null]);
    expect(cov).toBeCloseTo(0.01, 5);
  });

  it('returns 0 when no image is painted', () => {
    expect(coverage([12, 12], [[PAGE_W, 0, 0, PAGE_H, 0, 0], [2, 0, 0, 2, 0, 0]])).toBe(0);
  });

  it('respects save/restore scoping (transform does not leak past restore)', () => {
    // save, scale-to-page, restore, then paint a 1x1 image at identity.
    const cov = coverage(
      [10, 12, 11, 20],
      [null, [PAGE_W, 0, 0, PAGE_H, 0, 0], null, null],
    );
    expect(cov).toBeCloseTo(1 / (PAGE_W * PAGE_H), 8);
  });

  it('returns 0 for a zero-area page', () => {
    expect(maxImagePaintCoverage([20], [null], CODES, transform, 0, 0)).toBe(0);
  });
});
