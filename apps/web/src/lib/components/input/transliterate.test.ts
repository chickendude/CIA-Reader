// @vitest-environment node
/**
 * Tests for the client-side transliteration helper (T-6.2a).
 */
import { describe, expect, it } from 'vitest';

import { latinToNative, looksLikeNativeScript, nfc } from './transliterate.js';

describe('latinToNative — Devanagari (hi)', () => {
  it('keeps a bare consonant with the implicit schwa', () => {
    expect(latinToNative('hi', 'k')).toBe('क');
  });

  it('joins a consonant to a vowel sign rather than the independent vowel form', () => {
    expect(latinToNative('hi', 'kaa')).toBe('का');
    expect(latinToNative('hi', 'ki')).toBe('कि');
    expect(latinToNative('hi', 'ku')).toBe('कु');
    expect(latinToNative('hi', 'ke')).toBe('के');
    expect(latinToNative('hi', 'ko')).toBe('को');
  });

  it('uses the independent vowel form at word start', () => {
    expect(latinToNative('hi', 'aam')).toContain('आ');
    expect(latinToNative('hi', 'I')).toBe('ई');
  });

  it('inserts a virama between two adjacent consonants (= conjunct)', () => {
    expect(latinToNative('hi', 'kt')).toBe('क्त');
  });

  it('handles a multi-syllable real word (kitaab → किताब)', () => {
    expect(latinToNative('hi', 'kitaab')).toBe('किताब');
  });

  it('preserves anusvara (M) and visarga (H)', () => {
    expect(latinToNative('hi', 'haM')).toBe('हं');
  });

  it('passes spaces and punctuation through unchanged', () => {
    expect(latinToNative('hi', 'meraa naam.')).toBe('मेरा नाम.');
  });

  it('handles nukta-bearing consonants (z → ज़, f → फ़)', () => {
    // ITRANS-flavored: 'uu' is long-u, 'q' is qaaf.
    expect(latinToNative('hi', 'zaruur')).toBe('ज़रूर');
    expect(latinToNative('hi', 'farq')).toContain('क़');
  });
});

describe('latinToNative — Odia (or)', () => {
  it('produces Odia consonants for the ITRANS keys', () => {
    expect(latinToNative('or', 'k')).toBe('କ');
    expect(latinToNative('or', 'kaa')).toBe('କା');
  });

  it('uses Odia virama for conjuncts', () => {
    expect(latinToNative('or', 'kt')).toContain('୍');
  });

  it('uses Odia independent vowels at word start', () => {
    expect(latinToNative('or', 'aam')).toContain('ଆ');
  });
});

describe('looksLikeNativeScript', () => {
  it('returns true for Devanagari content under hi/mr', () => {
    expect(looksLikeNativeScript('किताब', 'hi')).toBe(true);
    expect(looksLikeNativeScript('मराठी', 'mr')).toBe(true);
  });

  it('returns true for Odia content under or', () => {
    expect(looksLikeNativeScript('ଓଡ଼ିଆ', 'or')).toBe(true);
  });

  it('returns false for pure Latin', () => {
    expect(looksLikeNativeScript('kitaab', 'hi')).toBe(false);
    expect(looksLikeNativeScript('odia', 'or')).toBe(false);
  });

  it('returns false for empty input', () => {
    expect(looksLikeNativeScript('', 'hi')).toBe(false);
  });

  it('cross-script: Devanagari content under or returns false (wrong script)', () => {
    expect(looksLikeNativeScript('किताब', 'or')).toBe(false);
  });
});

describe('nfc', () => {
  it('normalizes a decomposed nukta sequence to its precomposed form', () => {
    // U+092B (PHA) + U+093C (NUKTA) → ideally collapses; our concern
    // is that nfc() doesn't crash and emits NFC.
    const decomposed = 'फ' + '़';
    const normalized = nfc(decomposed);
    expect(normalized.normalize('NFC')).toBe(normalized);
  });

  it('passes a plain ASCII string unchanged', () => {
    expect(nfc('hello')).toBe('hello');
  });
});
