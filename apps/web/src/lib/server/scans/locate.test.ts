// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { proposeCrop } from './locate.js';
import type { ScanOcrWord } from '../db/schema.js';

function words(line: string, y: number): ScanOcrWord[] {
  return line.split(' ').map((s, i) => ({ s, x: 0.1 + i * 0.08, y, w: 0.07, h: 0.02 }));
}

const PAGE: ScanOcrWord[] = [
  ...words('ଅଭିଧାନ Abhidhana', 0.1),
  ...words('1. Speaking. 2. Name. 3. Vocabulary; dictionary; lexicon.', 0.14),
  ...words('another entry entirely here', 0.2),
];

describe('proposeCrop', () => {
  it('finds a 3+-word run from the draft sense and unions its boxes with padding', () => {
    const proposal = proposeCrop(PAGE, {
      senseBodies: ['3. Vocabulary; dictionary; lexicon.'],
    });
    expect(proposal).not.toBeNull();
    const { crop, confidence } = proposal!;
    expect(confidence).toBeGreaterThan(0);
    // The matched words sit on the y=0.14 line.
    expect(crop.y).toBeLessThan(0.14);
    expect(crop.y + crop.h).toBeGreaterThan(0.16);
    expect(crop.x).toBeGreaterThanOrEqual(0);
    expect(crop.x + crop.w).toBeLessThanOrEqual(1);
  });

  it('returns null when the draft has no usable English sense', () => {
    expect(proposeCrop(PAGE, { senseBodies: ['କଥନ'] })).toBeNull();
    expect(proposeCrop(PAGE, { senseBodies: [] })).toBeNull();
  });

  it('returns null when no run reaches the minimum length', () => {
    expect(
      proposeCrop(PAGE, { senseBodies: ['Completely unrelated draft gloss text'] }),
    ).toBeNull();
  });

  it('returns null without OCR words', () => {
    expect(proposeCrop(null, { senseBodies: ['Vocabulary; dictionary; lexicon.'] })).toBeNull();
    expect(proposeCrop([], { senseBodies: ['Vocabulary; dictionary; lexicon.'] })).toBeNull();
  });
});
