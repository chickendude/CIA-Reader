import { describe, expect, it } from 'vitest';
import { placeTooltip, type AnchorRect } from './tooltip-position.js';

function rect(top: number, left: number, width = 60, height = 24): AnchorRect {
  return { top, left, width, height, bottom: top + height, right: left + width };
}

const VP = { width: 1024, height: 768 };

describe('placeTooltip', () => {
  it('centers the tooltip above the anchor word when there is room', () => {
    const placement = placeTooltip(rect(200, 400), 200, 80, VP);
    expect(placement.flipped).toBe(false);
    expect(placement.top).toBe(200 - 80 - 8); // above with 8px margin
    // Center: anchor at 400 + 30 = 430; tooltip half-width 100 → left=330.
    expect(placement.left).toBe(330);
  });

  it('flips below when the anchor is too close to the top', () => {
    const placement = placeTooltip(rect(4, 400), 200, 80, VP);
    expect(placement.flipped).toBe(true);
    expect(placement.top).toBe(4 + 24 + 8);
  });

  it('clamps to the left margin when the centered tooltip would overflow left', () => {
    const placement = placeTooltip(rect(200, 4), 200, 80, VP);
    expect(placement.left).toBe(8);
  });

  it('clamps to the right margin when the centered tooltip would overflow right', () => {
    const placement = placeTooltip(rect(200, 1000), 200, 80, VP);
    expect(placement.left).toBe(VP.width - 8 - 200);
  });

  it('falls back to bottom-clamped placement when the tooltip cannot fit above OR below', () => {
    // Tiny viewport, tall tooltip — only the clamp branch wins.
    const tinyVp = { width: 320, height: 100 };
    const placement = placeTooltip(rect(10, 100, 40, 20), 200, 200, tinyVp);
    expect(placement.flipped).toBe(true);
    expect(placement.top).toBe(8); // clamped to top margin since neither above nor below fits
  });
});
