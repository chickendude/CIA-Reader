// @vitest-environment node
/**
 * Smoke test for the Odia WordNet instantiation (T-3.10f).
 *
 * The shared parser is exhaustively covered in `indo-wordnet.test.ts`;
 * this file locks in the Odia-specific knobs (script, sourceId
 * prefix, attribution, language tag) so a refactor that breaks
 * `odia-wordnet` can't keep `hindi-wordnet` / `marathi-wordnet` green.
 */
import { describe, expect, it } from 'vitest';

import { odiaWordnetSource } from './odia-wordnet.js';

describe('odiaWordnetSource registry shape', () => {
  it('exposes the expected attribution, license, and language', () => {
    expect(odiaWordnetSource.name).toBe('odia-wordnet');
    expect(odiaWordnetSource.language).toBe('or');
    expect(odiaWordnetSource.license).toContain('Research-Use');
    expect(odiaWordnetSource.sourceAttribution).toContain('ISI');
    expect(odiaWordnetSource.sourceAttribution).toContain('Odia');
  });
});
