import { describe, expect, it } from 'vitest';

import { posAbbr, posFullName } from './pos-labels.js';

describe('pos-labels', () => {
  it.each([
    ['NOUN', 'n', 'noun'],
    ['VERB', 'v', 'verb'],
    ['ADJ', 'adj', 'adjective'],
    ['ADV', 'adv', 'adverb'],
    ['PROPN', 'prop', 'proper noun'],
    ['PRON', 'pron', 'pronoun'],
    ['ADP', 'adp', 'adposition'],
    ['AUX', 'aux', 'auxiliary'],
    ['CCONJ', 'conj', 'coordinating conjunction'],
    ['SCONJ', 'sconj', 'subordinating conjunction'],
    ['DET', 'det', 'determiner'],
    ['INTJ', 'intj', 'interjection'],
    ['NUM', 'num', 'numeral'],
    ['PART', 'part', 'particle'],
  ] as const)('maps %s to abbr=%s and fullName=%s', (pos, abbr, full) => {
    expect(posAbbr(pos)).toBe(abbr);
    expect(posFullName(pos)).toBe(full);
  });

  it('uppercases lookup keys so lowercase inputs still resolve', () => {
    expect(posAbbr('noun')).toBe('n');
    expect(posFullName('verb')).toBe('verb');
  });

  it('falls back to a lowercased copy when the tag is unknown', () => {
    expect(posAbbr('NEW_TAG')).toBe('new_tag');
    expect(posFullName('NEW_TAG')).toBe('new_tag');
  });

  it('returns empty string when called with empty input', () => {
    expect(posAbbr('')).toBe('');
    expect(posFullName('')).toBe('');
  });
});
