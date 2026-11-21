import { describe, expect, it } from 'vitest';
import { hindiSyllableRuns, matchHindiMerges } from './hindi-merge';

function matches(text: string, headwords: string[]) {
  const tokens = [...text.matchAll(/[\p{L}\p{M}]+|\s+|./gu)].map(([surface], idx) => ({
    idx,
    surface,
    isWord: /\p{L}/u.test(surface),
  }));
  return matchHindiMerges(
    hindiSyllableRuns(tokens),
    headwords.map((headword) => ({ id: headword, headword, pos: 'NOUN' })),
  );
}

describe('Hindi syllable merges', () => {
  const source = 'विन्ग-गार-डियम लेवि-यो-सा';
  const headword = 'विन्गार्डियम लेवियोसा';
  it('matches the complete printed spell and preserves the source span', () => {
    expect(
      matches(source, [headword, 'विन्गार्डियम', 'लेवियोसा']).map((m) => [
        m.first,
        m.last,
        m.headword,
      ]),
    ).toEqual([
      [0, 10, headword],
      [0, 4, 'विन्गार्डियम'],
      [6, 10, 'लेवियोसा'],
    ]);
    expect(matches(source, [headword])[0]?.surface).toBe(source);
  });

  it('requires a full headword and preserves word and sentence boundaries', () => {
    expect(matches(source, ['लेवि', 'लेवियोस', 'गार्डियम', 'विंगार्डियम लेवियोसा'])).toEqual([]);
    for (const gap of [', ', '\n', ' फिर ', '। '])
      expect(matches(source.replace(' ', gap), [headword])).toEqual([]);
    expect(matches('लेवि - यो - सा', ['लेवियोसा'])).toEqual([]);
    expect(matches('लेवि‑यो‐सा', ['लेवियोसा'])).toHaveLength(1);
  });
});
