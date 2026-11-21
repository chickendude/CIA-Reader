import { describe, expect, it } from 'vitest';
import { joinDictionaryEntries } from './joined-tokens';
import type { ServerToken } from './types';

function token(idx: number, surface: string, reading: Partial<ServerToken> = {}): ServerToken {
  return {
    idx,
    id: String(idx),
    surface,
    isWord: true,
    isAmbiguous: false,
    isOov: false,
    lemmaId: null,
    romanization: null,
    glossDefault: null,
    personalGloss: null,
    candidates: [],
    features: {},
    numberForms: null,
    status: 'unknown',
    ...reading,
  };
}

const spell = [
  token(0, 'विन्गार्डियम', {
    lemmaId: 'spell',
    headword: 'विन्गार्डियम लेवियोसा',
    features: { Compound: 'Yes' },
    dictionarySpanEnds: { spell: 3 },
    romanization: 'vingārḍiyam',
  }),
  token(1, ' ', { isWord: false }),
  token(2, 'लेवियोसा', { romanization: 'leviyosā' }),
  token(3, '!', { isWord: false }),
];

describe('multiword Hindi dictionary entries in the reader', () => {
  it('opens either word as the same entry and leaves adjacent punctuation outside the hit area', () => {
    const result = joinDictionaryEntries(spell);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: '0',
      lemmaId: 'spell',
      lastTokenIdx: 2,
      surface: 'विन्गार्डियम लेवियोसा',
      romanization: 'vingārḍiyam leviyosā',
    });
    expect(result[1]).toBe(spell[3]);
  });

  it('keeps the individual words when the selected reading changes or a covered word has a correction', () => {
    const standalone = [{ ...spell[0]!, lemmaId: 'name', features: {} }, ...spell.slice(1)];
    expect(joinDictionaryEntries(standalone)).toEqual(standalone);
    const corrected = spell.map((t) => (t.idx === 2 ? { ...t, correctedByViewer: true } : t));
    expect(joinDictionaryEntries(corrected)).toEqual(corrected);
  });
});
