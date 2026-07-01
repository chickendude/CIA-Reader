// @vitest-environment node
import { describe, expect, it } from 'vitest';

// The seed script guards its DB run behind a direct-execution check, so
// importing it here only pulls the pure data + expansion helpers.
import {
  BASQUE_OVERRIDES,
  withTitleCaseVariants,
} from '../../../../scripts/seed-form-overrides.mjs';

describe('Basque form-override seed', () => {
  it('covers each of the six reported Basque forms exactly once', () => {
    const surfaces = BASQUE_OVERRIDES.map((o) => o.surface);
    expect(new Set(surfaces).size).toBe(surfaces.length);
    expect(surfaces).toEqual(
      expect.arrayContaining([
        'parean',
        'bidegurutzea',
        'arrastiko',
        'mendebalerantz',
        'badiara',
        'aspaldion',
      ]),
    );
  });

  it('keeps aspaldion as its own lemma rather than collapsing to aspaldi', () => {
    const aspaldion = BASQUE_OVERRIDES.find((o) => o.surface === 'aspaldion');
    expect(aspaldion?.lemma).toBe('aspaldion');
  });

  it('adds a Title-case variant so sentence-initial forms are caught', () => {
    const expanded = withTitleCaseVariants(BASQUE_OVERRIDES);
    const surfaces = expanded.map((e) => e.surface);
    // Both the lowercase and sentence-initial forms resolve to the fix.
    expect(surfaces).toContain('badiara');
    expect(surfaces).toContain('Badiara');
    // The Title-case row targets the same lemma as its lowercase source.
    const lower = expanded.find((e) => e.surface === 'badiara');
    const title = expanded.find((e) => e.surface === 'Badiara');
    expect(title?.lemma).toBe(lower?.lemma);
    // Exactly doubles the list (every seed surface is lowercase).
    expect(expanded).toHaveLength(BASQUE_OVERRIDES.length * 2);
  });
});
