import { describe, expect, it } from 'vitest';

import {
  validatePhraseSelection,
  SENTENCE_END_RE,
} from './phrase-selection.js';
import type { ServerToken } from './types.js';

/**
 * Unit tests for the phrase-create selection validator (T-14.3a).
 *
 * The validator gates the shift-click gesture in
 * `ChapterBody.svelte` — these cases pin its boundary behaviour
 * so future drag-select / touch-press flows can re-use the same
 * helper without re-deriving the rules.
 */

function tok(
  idx: number,
  surface: string,
  opts: { isWord?: boolean } = {},
): ServerToken {
  return {
    id: `t-${idx}`,
    idx,
    surface,
    isWord: opts.isWord ?? true,
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
  };
}

describe('SENTENCE_END_RE', () => {
  it('matches Devanagari, Odia, and Western sentence-end marks', () => {
    expect(SENTENCE_END_RE.test('।')).toBe(true);
    expect(SENTENCE_END_RE.test('॥')).toBe(true);
    expect(SENTENCE_END_RE.test('.')).toBe(true);
    expect(SENTENCE_END_RE.test('!')).toBe(true);
    expect(SENTENCE_END_RE.test('?')).toBe(true);
    // Quoted sentence-end punctuation is matched too — the
    // resolver doesn't distinguish "." from `."`.
    expect(SENTENCE_END_RE.test('".')).toBe(true);
  });

  it('does not match commas or interior punctuation', () => {
    expect(SENTENCE_END_RE.test(',')).toBe(false);
    expect(SENTENCE_END_RE.test(';')).toBe(false);
    expect(SENTENCE_END_RE.test('-')).toBe(false);
  });
});

describe('validatePhraseSelection', () => {
  it('accepts a contiguous two-word run as a phrase', () => {
    const tokens = [
      tok(0, 'मैंने'),
      tok(1, 'इंतज़ार'),
      tok(2, 'किया'),
      tok(3, '।', { isWord: false }),
    ];
    const result = validatePhraseSelection(tokens, 1, 2);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('unreachable');
    expect(result.surfaces).toEqual(['इंतज़ार', 'किया']);
    expect(result.rangeIdx).toEqual({ start: 1, end: 2 });
  });

  it('skips non-word punctuation tokens between selected words', () => {
    const tokens = [
      tok(0, 'और'),
      tok(1, 'इंतज़ार'),
      tok(2, ',', { isWord: false }),
      tok(3, 'किया'),
    ];
    const result = validatePhraseSelection(tokens, 1, 3);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('unreachable');
    // Comma is dropped — only the two words contribute to surfaces.
    expect(result.surfaces).toEqual(['इंतज़ार', 'किया']);
  });

  it('rejects a single-token "range"', () => {
    const tokens = [tok(0, 'a'), tok(1, 'b')];
    const result = validatePhraseSelection(tokens, 0, 0);
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') throw new Error('unreachable');
    expect(result.message).toMatch(/at least two/);
  });

  it('rejects a selection that crosses a sentence-ending mark', () => {
    const tokens = [
      tok(0, 'इंतज़ार'),
      tok(1, '।', { isWord: false }),
      tok(2, 'किया'),
    ];
    const result = validatePhraseSelection(tokens, 0, 2);
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') throw new Error('unreachable');
    expect(result.message).toMatch(/sentence/);
  });

  it('rejects a selection that crosses a Western period', () => {
    const tokens = [
      tok(0, 'I'),
      tok(1, 'wait'),
      tok(2, '.', { isWord: false }),
      tok(3, 'Then'),
    ];
    const result = validatePhraseSelection(tokens, 1, 3);
    expect(result.kind).toBe('error');
  });

  it('accepts the reversed range (target before anchor)', () => {
    const tokens = [
      tok(0, 'मैंने'),
      tok(1, 'इंतज़ार'),
      tok(2, 'किया'),
    ];
    // Click order shouldn't matter — the helper canonicalises on lo/hi.
    const result = validatePhraseSelection(tokens, 2, 0);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('unreachable');
    expect(result.surfaces).toEqual(['मैंने', 'इंतज़ार', 'किया']);
    expect(result.rangeIdx).toEqual({ start: 0, end: 2 });
  });

  it('rejects a selection that exceeds 8 words', () => {
    // Build 10 word tokens so the range is too long.
    const tokens = Array.from({ length: 10 }, (_, i) => tok(i, `w${i}`));
    const result = validatePhraseSelection(tokens, 0, 9);
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') throw new Error('unreachable');
    expect(result.message).toMatch(/8 words/);
  });

  it('rejects a selection where every interior token is non-word', () => {
    // Pure-punctuation range (e.g. clicking across only commas)
    // results in fewer than two surfaces — caught by the
    // MIN_PHRASE_TOKENS guard.
    const tokens = [
      tok(0, ',', { isWord: false }),
      tok(1, ' ', { isWord: false }),
      tok(2, ',', { isWord: false }),
    ];
    const result = validatePhraseSelection(tokens, 0, 2);
    expect(result.kind).toBe('error');
  });
});
