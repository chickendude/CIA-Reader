import { describe, expect, it } from 'vitest';

import {
  STATUS_TO_CODE,
  looksLikeNumberToken,
  paragraphsOfTokens,
  statusToCode,
  tokenize,
} from './types.js';

describe('looksLikeNumberToken (T-2.8)', () => {
  it.each([
    '0',
    '123',
    '1,000',
    '12,345',
    '1,00,000',
    '1,234,567',
    '१२३',
    '१,२३४',
    '१,००,०००',
    '୧୨୩',
    '୧,୨୩୪',
  ])('accepts %s', (s) => {
    expect(looksLikeNumberToken(s)).toBe(true);
  });

  it.each([
    '',
    'abc',
    '12a',
    '१23', // mixed script
    '1२3',
    '1,२३४', // mixed script across comma groups
    '-1',
    '1.5',
    ',1',
    '1,',
    '1,,000',
    ',',
  ])('rejects %s', (s) => {
    expect(looksLikeNumberToken(s)).toBe(false);
  });
});

describe('tokenize', () => {
  it('splits on word boundaries while preserving whitespace + punctuation', () => {
    const tokens = tokenize('hello, world!');
    // Punctuation runs and whitespace runs are separate tokens — the
    // reader doesn't render them as a single span and we don't want
    // false equality between "hello," and "hello, " in the future.
    expect(tokens.map((t) => t.surface)).toEqual([
      'hello',
      ',',
      ' ',
      'world',
      '!',
    ]);
    expect(tokens.map((t) => t.isWord)).toEqual([
      true,
      false,
      false,
      true,
      false,
    ]);
  });

  it('keeps Devanagari + Odia codepoints as words', () => {
    const tokens = tokenize('बोलना और ଓଡ଼ିଆ');
    const words = tokens.filter((t) => t.isWord).map((t) => t.surface);
    expect(words).toEqual(['बोलना', 'और', 'ଓଡ଼ିଆ']);
  });

  it('numbers tokens contiguously starting at 0', () => {
    const tokens = tokenize('a b c');
    expect(tokens.map((t) => t.idx)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('paragraphsOfTokens', () => {
  it('cuts paragraphs on blank-line whitespace tokens', () => {
    const tokens = tokenize('one two\n\nthree four\n\nfive');
    const paras = paragraphsOfTokens(tokens);
    expect(paras).toHaveLength(3);
    expect(paras.map((p) => p.filter((t) => t.isWord).map((t) => t.surface))).toEqual(
      [['one', 'two'], ['three', 'four'], ['five']],
    );
  });

  it('keeps a single-paragraph chapter as one paragraph', () => {
    const tokens = tokenize('one two three');
    expect(paragraphsOfTokens(tokens)).toHaveLength(1);
  });

  it('skips empty paragraphs from runs of blank lines', () => {
    const tokens = tokenize('one\n\n\n\ntwo');
    expect(paragraphsOfTokens(tokens)).toHaveLength(2);
  });
});

describe('statusToCode', () => {
  it('maps every ServerToken status to a stable numeric code', () => {
    expect(statusToCode('unknown')).toBe('0');
    expect(statusToCode('learning')).toBe('2');
    expect(statusToCode('known')).toBe('4');
    expect(statusToCode('ignored')).toBe('5');
  });

  it('exposes the same mapping as a constant for callers that prefer the table', () => {
    expect(STATUS_TO_CODE).toEqual({
      unknown: '0',
      learning: '2',
      known: '4',
      ignored: '5',
    });
  });
});
