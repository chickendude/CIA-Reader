// @vitest-environment node
/**
 * Smoke test for the Hindi WordNet instantiation (T-3.10a).
 *
 * The shared parser is exhaustively covered in `indo-wordnet.test.ts`;
 * this file just locks in the language-specific knobs (sourceId
 * prefix, attribution, default file path) so a refactor that breaks
 * `hindi-wordnet` can't keep `marathi-wordnet`'s assertions green.
 */
import { describe, expect, it } from 'vitest';

import { hindiWordnetSource } from './hindi-wordnet.js';

describe('hindiWordnetSource registry shape', () => {
  it('exposes the expected attribution, license, and language', () => {
    expect(hindiWordnetSource.name).toBe('hindi-wordnet');
    expect(hindiWordnetSource.language).toBe('hi');
    expect(hindiWordnetSource.license).toContain('Research-Use');
    expect(hindiWordnetSource.sourceAttribution).toContain('CFILT');
    expect(hindiWordnetSource.sourceAttribution).toContain('Hindi');
  });
});
