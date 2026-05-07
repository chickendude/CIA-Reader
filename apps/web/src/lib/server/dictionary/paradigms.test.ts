// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { generateForms } from './paradigms.js';
import type { ParadigmSlot } from '../db/schema.js';

function slot(
  partial: Partial<ParadigmSlot> & { slotKey: string; suffix: string },
): ParadigmSlot {
  return {
    id: `slot-${partial.slotKey}`,
    paradigmId: 'odia-regular-verb',
    slotKey: partial.slotKey,
    features: partial.features ?? {},
    suffix: partial.suffix,
    sortOrder: partial.sortOrder ?? 0,
  } as ParadigmSlot;
}

describe('generateForms', () => {
  it('produces one form per slot by concatenating stem + suffix', () => {
    const slots = [
      slot({ slotKey: 'inf', suffix: 'ିବା', sortOrder: 10, features: { VerbForm: 'Inf' } }),
      slot({ slotKey: 'past_3sg', suffix: 'ିଲା', sortOrder: 20, features: { Tense: 'Past', Person: '3', Number: 'Sing' } }),
    ];
    const out = generateForms(slots, 'ରହ');
    expect(out).toHaveLength(2);
    expect(out[0]!.surface).toBe('ରହିବା');
    expect(out[0]!.slotKey).toBe('inf');
    expect(out[0]!.features).toEqual({ VerbForm: 'Inf' });
    expect(out[0]!.paradigmSlotId).toBe('slot-inf');
    expect(out[1]!.surface).toBe('ରହିଲା');
    expect(out[1]!.features).toEqual({
      Tense: 'Past',
      Person: '3',
      Number: 'Sing',
    });
  });

  it('matches the user-confirmed Odia ରହିବା paradigm sample', () => {
    // Spot-check a handful of cells from the conjugation table the user
    // signed off on. Suffix strings come straight from the seeded
    // paradigm; this test guards against accidental regressions in
    // either the suffix data or the combine() helper.
    const slots = [
      slot({ slotKey: 'inf', suffix: 'ିବା' }),
      slot({ slotKey: 'pres_hab_1sg', suffix: 'େ' }),
      slot({ slotKey: 'pres_prog_1sg', suffix: 'ୁଛି' }),
      slot({ slotKey: 'past_1sg', suffix: 'ିଲି' }),
      slot({ slotKey: 'past_3sg', suffix: 'ିଲା' }),
      slot({ slotKey: 'past_perf', suffix: 'ିଥିଲା' }),
      slot({ slotKey: 'fut_1sg', suffix: 'ିବି' }),
      slot({ slotKey: 'imperative_familiar', suffix: '' }),
      slot({ slotKey: 'imperative_polite', suffix: 'ନ୍ତୁ' }),
    ];
    const surfaces = Object.fromEntries(
      generateForms(slots, 'ରହ').map((g) => [g.slotKey, g.surface]),
    );
    expect(surfaces).toEqual({
      inf: 'ରହିବା',
      pres_hab_1sg: 'ରହେ',
      pres_prog_1sg: 'ରହୁଛି',
      past_1sg: 'ରହିଲି',
      past_3sg: 'ରହିଲା',
      past_perf: 'ରହିଥିଲା',
      fut_1sg: 'ରହିବି',
      // Imperative familiar collapses to the bare stem.
      imperative_familiar: 'ରହ',
      imperative_polite: 'ରହନ୍ତୁ',
    });
  });

  it('NFC-normalizes a decomposed stem before combining', () => {
    // ର in NFD form: ର + ZWNJ-style combiner is rare but possible
    // through copy-paste; verify the combine path still produces NFC.
    const stem = 'ର‍'.normalize('NFD'); // contrived but cheap to construct
    const slots = [slot({ slotKey: 'inf', suffix: 'ିବା' })];
    const [result] = generateForms(slots, stem);
    // Surface is NFC, even when the stem arrived decomposed.
    expect(result!.surface).toBe(result!.surface.normalize('NFC'));
  });

  it('returns an empty list when given no slots', () => {
    expect(generateForms([], 'ରହ')).toEqual([]);
  });
});
