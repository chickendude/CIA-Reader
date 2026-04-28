import { describe, expect, it } from 'vitest';
import { clampPage, pageCountFor, pageOffset } from './paginate.js';

describe('pageCountFor', () => {
  it('reports 1 page when content fits the viewport', () => {
    expect(pageCountFor(400, 600)).toBe(1);
    expect(pageCountFor(0, 600)).toBe(1);
  });

  it('reports the correct number of pages when content exceeds the viewport', () => {
    expect(pageCountFor(1200, 600)).toBe(2);
    expect(pageCountFor(1201, 600)).toBe(3);
  });

  it("doesn't return 0 even for a zero-size viewport (defensive)", () => {
    expect(pageCountFor(1200, 0)).toBe(1);
  });
});

describe('clampPage', () => {
  it('keeps the index inside [0, count - 1]', () => {
    expect(clampPage(-1, 5)).toBe(0);
    expect(clampPage(0, 5)).toBe(0);
    expect(clampPage(4, 5)).toBe(4);
    expect(clampPage(5, 5)).toBe(4);
    expect(clampPage(99, 5)).toBe(4);
  });

  it('returns 0 when the chapter has no pages yet', () => {
    expect(clampPage(2, 0)).toBe(0);
  });
});

describe('pageOffset', () => {
  it('returns 0 for page 0', () => {
    expect(pageOffset(0, 600)).toBe(0);
  });

  it('returns idx * pageSize for subsequent pages', () => {
    expect(pageOffset(1, 600)).toBe(600);
    expect(pageOffset(3, 600)).toBe(1800);
  });

  it('clamps negative idx to 0', () => {
    expect(pageOffset(-2, 600)).toBe(0);
  });
});
