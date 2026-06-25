import { describe, expect, it } from 'vitest';

import { splitCueWords } from './tokenize';

describe('splitCueWords', () => {
  it('separates words from punctuation/spacing', () => {
    const parts = splitCueWords('Heldu gara, azkenean.');
    expect(parts.filter((p) => p.word).map((p) => p.text)).toEqual([
      'Heldu',
      'gara',
      'azkenean',
    ]);
    // round-trips back to the original text
    expect(parts.map((p) => p.text).join('')).toBe('Heldu gara, azkenean.');
  });

  it('keeps apostrophes and hyphens inside a word', () => {
    const parts = splitCueWords("Tik Tok-en zer'bait");
    expect(parts.filter((p) => p.word).map((p) => p.text)).toEqual([
      'Tik',
      'Tok-en',
      "zer'bait",
    ]);
  });

  it('handles a line with no words', () => {
    expect(splitCueWords('— ¿?').every((p) => !p.word)).toBe(true);
  });
});
