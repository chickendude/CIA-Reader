import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetScrollLockForTests, lockScroll } from './scroll-lock.js';

beforeEach(() => {
  __resetScrollLockForTests();
  document.body.style.overflow = '';
  // jsdom doesn't implement scrollTo; stub it out so the
  // restore-on-unlock branch doesn't pollute stderr.
  vi.stubGlobal('scrollTo', vi.fn());
});

afterEach(() => {
  __resetScrollLockForTests();
  document.body.style.overflow = '';
  vi.unstubAllGlobals();
});

describe('lockScroll', () => {
  it('hides body overflow on first lock and restores it on release', () => {
    document.body.style.overflow = 'auto';
    const release = lockScroll();
    expect(document.body.style.overflow).toBe('hidden');
    release();
    expect(document.body.style.overflow).toBe('auto');
  });

  it('refcounts so two concurrent locks both have to release before unlocking', () => {
    const r1 = lockScroll();
    const r2 = lockScroll();
    expect(document.body.style.overflow).toBe('hidden');
    r1();
    // First release must NOT unlock — the second caller still holds a lock.
    expect(document.body.style.overflow).toBe('hidden');
    r2();
    expect(document.body.style.overflow).toBe('');
  });

  it('is idempotent on a release fn — calling twice does not over-decrement the count', () => {
    const r1 = lockScroll();
    const r2 = lockScroll();
    r1();
    r1(); // calling release twice should not unlock prematurely
    expect(document.body.style.overflow).toBe('hidden');
    r2();
    expect(document.body.style.overflow).toBe('');
  });
});
