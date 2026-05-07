import { describe, expect, it } from 'vitest';

import { FEATURE_LABELS, getFeaturePills } from './feature-labels.js';

describe('FEATURE_LABELS catalog', () => {
  it('has unique (key, value) pairs', () => {
    const seen = new Set<string>();
    for (const row of FEATURE_LABELS) {
      const key = `${row.featKey}::${row.featValue}`;
      expect(seen.has(key), `duplicate ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('every entry has a non-empty short and long label', () => {
    for (const row of FEATURE_LABELS) {
      expect(row.shortLabel.length).toBeGreaterThan(0);
      expect(row.longLabel.length).toBeGreaterThan(0);
    }
  });
});

describe('getFeaturePills', () => {
  it('returns pills sorted by sortOrder', () => {
    const pills = getFeaturePills('VERB', {
      Number: 'Sing',
      Tense: 'Past',
      Person: '1',
    });
    // Tense (20) → Person (70) → Number (80)
    expect(pills.map((p) => p.featKey)).toEqual(['Tense', 'Person', 'Number']);
  });

  it('filters by POS scope', () => {
    // Tense=Past is scoped to VERB only — a NOUN with the same blob
    // should not surface a Tense pill.
    const verb = getFeaturePills('VERB', { Tense: 'Past', Number: 'Sing' });
    const noun = getFeaturePills('NOUN', { Tense: 'Past', Number: 'Sing' });
    expect(verb.map((p) => p.featKey)).toContain('Tense');
    expect(noun.map((p) => p.featKey)).not.toContain('Tense');
    // Number is scoped to many POSes including NOUN and VERB.
    expect(verb.map((p) => p.featKey)).toContain('Number');
    expect(noun.map((p) => p.featKey)).toContain('Number');
  });

  it('surfaces unknown (key, value) pairs with raw labels', () => {
    const pills = getFeaturePills('VERB', { Foo: 'Bar' });
    expect(pills).toHaveLength(1);
    expect(pills[0]).toMatchObject({
      featKey: 'Foo',
      featValue: 'Bar',
      shortLabel: 'Bar',
      longLabel: 'Foo=Bar',
    });
  });

  it('produces the user-facing labels for an Odia past-1sg form', () => {
    const pills = getFeaturePills('VERB', {
      Tense: 'Past',
      Person: '1',
      Number: 'Sing',
    });
    expect(pills.map((p) => `${p.shortLabel}|${p.longLabel}`)).toEqual([
      'past|past tense',
      '1|first person',
      'sg|singular',
    ]);
  });

  it('returns an empty array for an empty features blob', () => {
    expect(getFeaturePills('VERB', {})).toEqual([]);
  });

  it('drops empty-string values without crashing', () => {
    const pills = getFeaturePills('VERB', { Tense: 'Past', Aspect: '' });
    expect(pills.map((p) => p.featKey)).toEqual(['Tense']);
  });
});
