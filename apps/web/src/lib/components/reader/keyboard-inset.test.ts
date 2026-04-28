// @vitest-environment node
/**
 * Tests for keyboard-inset math (T-5.1c).
 */
import { describe, expect, it } from 'vitest';

import { computeKeyboardInset } from './keyboard-inset.js';

describe('computeKeyboardInset', () => {
  it('returns 0 when visualViewport is missing', () => {
    expect(computeKeyboardInset(800, null)).toBe(0);
  });

  it('returns 0 when no keyboard is visible (vv covers the layout)', () => {
    expect(
      computeKeyboardInset(800, { height: 800, offsetTop: 0 }),
    ).toBe(0);
  });

  it('returns the gap when the keyboard occludes the bottom', () => {
    expect(
      computeKeyboardInset(800, { height: 480, offsetTop: 0 }),
    ).toBe(320);
  });

  it('accounts for an offset top (= a banner / pinned-keyboard configuration)', () => {
    expect(
      computeKeyboardInset(800, { height: 480, offsetTop: 100 }),
    ).toBe(220);
  });

  it('clamps a negative inset to 0', () => {
    expect(
      computeKeyboardInset(800, { height: 900, offsetTop: 0 }),
    ).toBe(0);
  });
});
