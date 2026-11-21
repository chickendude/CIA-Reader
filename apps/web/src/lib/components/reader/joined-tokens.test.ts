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
  const compound = {
    lemmaId: 'compound', headword: 'अस्त-व्यस्त', pos: 'ADJ', glossDefault: 'in disarray',
    features: { Compound: 'Yes' }, score: 1, status: 'learning' as const, bookFrequency: 2,
  };
  const printed = [
    token(0, 'अस्त', {
      lemmaId: 'part', headword: 'अस्त', candidates: [compound], isAmbiguous: true,
      dictionarySpanEnds: { compound: 3 },
    }),
    token(1, '-', { isWord: false }),
    token(2, 'व्यस्त', { lemmaId: 'busy', selectedBy: 'ai' }),
    token(3, ' ', { isWord: false }),
    token(4, 'व्यस्त', { lemmaId: 'busy' }),
  ];

  it('shows the whole hyphenated word once, even when the saved primary is its first part', () => {
    const result = joinDictionaryEntries(printed);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({
      id: '0', lastTokenIdx: 2, surface: 'अस्त-व्यस्त', lemmaId: 'compound',
      glossDefault: 'in disarray', status: 'learning', bookFrequency: 2,
      candidates: [], isAmbiguous: false,
    });
    expect(result[0]?.correctedByViewer).toBeFalsy();
    expect(result[2]).toBe(printed[4]);
  });

  it('retains alternative entries for the whole word', () => {
    const other = { ...compound, lemmaId: 'other', pos: 'NOUN' };
    const first = { ...printed[0]!, candidates: [compound, other], dictionarySpanEnds: { compound: 3, other: 3 } };
    expect(joinDictionaryEntries([first, ...printed.slice(1)])[0]).toMatchObject({
      lemmaId: 'compound', candidates: [other], isAmbiguous: true,
    });
  });

  it('honors a confirmed component and requires a match for the printed span', () => {
    for (const index of [0, 2]) {
      const reviewed = printed.map((t, i) => i === index ? { ...t, selectedBy: 'human' as const } : t);
      expect(joinDictionaryEntries(reviewed)).toEqual(reviewed);
    }
    const unmatched = [{ ...printed[0]!, dictionarySpanEnds: {} }, ...printed.slice(1)];
    expect(joinDictionaryEntries(unmatched)).toEqual(unmatched);
    const spaced = printed.map(t => t.idx === 1 ? { ...t, surface: ' - ' } : t);
    expect(joinDictionaryEntries(spaced)).toEqual(spaced);
  });

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

  it('shows the confirmed idiom across an AI suggestion on से', () => {
    const idiom = [
      token(0, 'टस', {
        lemmaId: 'idiom', headword: 'टस से मस न होना', selectedBy: 'human',
        features: { Compound: 'Yes' }, dictionarySpanEnds: { idiom: 9 },
      }),
      token(1, ' ', { isWord: false }),
      token(2, 'से', { selectedBy: 'ai' }),
      token(3, ' ', { isWord: false }),
      token(4, 'मस'),
      token(5, ' ', { isWord: false }),
      token(6, 'नहीं'),
      token(7, ' ', { isWord: false }),
      token(8, 'हुई'),
      token(9, '।', { isWord: false }),
    ];
    expect(joinDictionaryEntries(idiom)).toEqual([
      expect.objectContaining({ lemmaId: 'idiom', surface: 'टस से मस नहीं हुई', lastTokenIdx: 8 }),
      idiom[9],
    ]);
    const reviewed = idiom.map(t => t.idx === 2 ? { ...t, selectedBy: 'human' as const } : t);
    expect(joinDictionaryEntries(reviewed)).toEqual(reviewed);
  });

  it('keeps the individual words when the selected reading changes or a covered word has a correction', () => {
    const standalone = [{ ...spell[0]!, lemmaId: 'name', features: {} }, ...spell.slice(1)];
    expect(joinDictionaryEntries(standalone)).toEqual(standalone);
    const corrected = spell.map((t) => (t.idx === 2 ? { ...t, correctedByViewer: true } : t));
    expect(joinDictionaryEntries(corrected)).toEqual(corrected);
  });
});
