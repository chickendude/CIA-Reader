// @vitest-environment node
/**
 * Smoke test for the Marathi WordNet instantiation (T-3.10c).
 *
 * The shared parser is exhaustively covered in `indo-wordnet.test.ts`;
 * this file locks in the language-specific knobs (sourceId prefix,
 * attribution, default file path) so a refactor that breaks
 * `marathi-wordnet` can't keep `hindi-wordnet`'s assertions green.
 */
import { describe, expect, it } from 'vitest';

import { marathiWordnetSource } from './marathi-wordnet.js';

describe('marathiWordnetSource registry shape', () => {
  it('exposes the expected attribution, license, and language', () => {
    expect(marathiWordnetSource.name).toBe('marathi-wordnet');
    expect(marathiWordnetSource.language).toBe('mr');
    expect(marathiWordnetSource.license).toContain('Research-Use');
    expect(marathiWordnetSource.sourceAttribution).toContain('CFILT');
    expect(marathiWordnetSource.sourceAttribution).toContain('Marathi');
  });
});
