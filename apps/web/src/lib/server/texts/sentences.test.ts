// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { sentenceFromTokens } from './sentences.js';

// Mirrors the tokenizer: words, punctuation, and whitespace are each their own
// token; sentence-enders ('.', '?', …) are standalone PUNCT tokens.
const TOKENS = [
  { idx: 0, surface: 'Portuetxe' },
  { idx: 1, surface: ' ' },
  { idx: 2, surface: 'kalea' },
  { idx: 3, surface: ',' },
  { idx: 4, surface: ' ' },
  { idx: 5, surface: '88' },
  { idx: 6, surface: ' ' },
  { idx: 7, surface: 'bis' },
  { idx: 8, surface: '.' },
  { idx: 9, surface: ' ' },
  { idx: 10, surface: 'Bigarren' },
  { idx: 11, surface: ' ' },
  { idx: 12, surface: 'esaldia' },
  { idx: 13, surface: '.' },
];

describe('sentenceFromTokens', () => {
  it('returns the sentence containing a token in the first sentence', () => {
    expect(sentenceFromTokens(TOKENS, 2)).toBe('Portuetxe kalea, 88 bis.');
    expect(sentenceFromTokens(TOKENS, 5)).toBe('Portuetxe kalea, 88 bis.');
  });

  it('returns the sentence containing a token in a later sentence', () => {
    expect(sentenceFromTokens(TOKENS, 12)).toBe('Bigarren esaldia.');
  });

  it('handles the sentence-ending token itself', () => {
    expect(sentenceFromTokens(TOKENS, 8)).toBe('Portuetxe kalea, 88 bis.');
  });

  it('returns the whole run when there is no terminal punctuation', () => {
    const noPunct = [
      { idx: 0, surface: 'bat' },
      { idx: 1, surface: ' ' },
      { idx: 2, surface: 'bi' },
    ];
    expect(sentenceFromTokens(noPunct, 2)).toBe('bat bi');
  });

  it('splits on an ellipsis', () => {
    const ell = [
      { idx: 0, surface: 'Tira' },
      { idx: 1, surface: '…' },
      { idx: 2, surface: ' ' },
      { idx: 3, surface: 'gero' },
    ];
    expect(sentenceFromTokens(ell, 3)).toBe('gero');
  });

  it('returns empty string when the token idx is not present', () => {
    expect(sentenceFromTokens(TOKENS, 999)).toBe('');
  });

  // Regression: the worker emits paragraph/heading/title breaks as non-word
  // tokens whose surface spans a blank line. Without honouring them, the
  // backward scan sailed past a heading with no terminal punctuation and
  // glued the title + heading onto the following sentence.
  const BLOCKS = [
    { idx: 0, surface: 'Hitzaurrea', isWord: true }, // chapter title
    { idx: 1, surface: '\n\n', isWord: false },
    { idx: 2, surface: 'HITZAURREA', isWord: true }, // heading
    { idx: 3, surface: '\n\n', isWord: false },
    { idx: 4, surface: 'Azken', isWord: true },
    { idx: 5, surface: ' ', isWord: false },
    { idx: 6, surface: 'urteotan', isWord: true },
    { idx: 7, surface: ' ', isWord: false },
    { idx: 8, surface: 'erraztu', isWord: true },
    { idx: 9, surface: '.', isWord: false },
  ];

  it('does not cross a paragraph break into a preceding heading or title', () => {
    expect(sentenceFromTokens(BLOCKS, 6)).toBe('Azken urteotan erraztu.');
  });

  it('returns only the heading when a heading word is clicked', () => {
    expect(sentenceFromTokens(BLOCKS, 2)).toBe('HITZAURREA');
  });

  it('returns only the title when the title word is clicked', () => {
    expect(sentenceFromTokens(BLOCKS, 0)).toBe('Hitzaurrea');
  });

  it('stops at a paragraph break with no terminal punctuation on either side', () => {
    const tokens = [
      { idx: 0, surface: 'lehena', isWord: true },
      { idx: 1, surface: '\n\n', isWord: false },
      { idx: 2, surface: 'bigarrena', isWord: true },
    ];
    expect(sentenceFromTokens(tokens, 2)).toBe('bigarrena');
    expect(sentenceFromTokens(tokens, 0)).toBe('lehena');
  });
});
