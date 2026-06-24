import { describe, expect, it } from 'vitest';

import type { ParseResponse, ParseTokenWire } from '../shared/api-types';
import { pickLemmas } from './parse-tokens';

const token = (over: Partial<ParseTokenWire>): ParseTokenWire => ({
  idx: 0,
  surface: 'x',
  is_word: true,
  candidates: [],
  is_ambiguous: false,
  is_oov: false,
  romanization: null,
  ...over,
});

const parse = (tokens: ParseTokenWire[]): ParseResponse => ({ language: 'eu', tokens });

describe('pickLemmas', () => {
  it('returns deduped lemmas for the first lexical token', () => {
    const out = pickLemmas(
      parse([
        token({
          surface: 'jaten',
          candidates: [
            { lemma: 'jan', pos: 'VERB', score: 0.9, features: {} },
            { lemma: 'jan', pos: 'NOUN', score: 0.1, features: {} },
            { lemma: 'jate', pos: 'NOUN', score: 0.05, features: {} },
          ],
        }),
      ]),
    );
    expect(out).toEqual(['jan', 'jate']);
  });

  it('skips non-word (punctuation) tokens', () => {
    const out = pickLemmas(
      parse([
        token({ surface: '¿', is_word: false, candidates: [] }),
        token({
          surface: 'etxe',
          candidates: [{ lemma: 'etxe', pos: 'NOUN', score: 1, features: {} }],
        }),
      ]),
    );
    expect(out).toEqual(['etxe']);
  });

  it('returns an empty list when there is no lexical token', () => {
    expect(pickLemmas(parse([token({ is_word: false })]))).toEqual([]);
  });
});
