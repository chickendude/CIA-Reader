// @vitest-environment node
/**
 * Unit tests for the shared-types `stripNukta` / `hasNukta` helpers
 * (#318). The helpers live in `@ciareader/shared-types` (pure
 * data-only package, no test infra of its own); we colocate the
 * tests under apps/web so they run inside the existing Vitest setup.
 *
 * Coverage targets the two encodings every nukta consonant has —
 * atomic precomposed codepoint (e.g. `U+0958` क़) vs. base + U+093C —
 * and the lossy nature of the strip (intentional: `ज़रा` and `जरा` map
 * to the same key, which is the whole point of the fallback tier).
 */
import { describe, expect, it } from 'vitest';

import { hasNukta, stripNukta } from '@ciareader/shared-types';

describe('stripNukta', () => {
  it('removes a decomposed nukta on a verb stem', () => {
    expect(stripNukta('पढ़ना')).toBe('पढना');
    expect(stripNukta('बढ़ना')).toBe('बढना');
    expect(stripNukta('चढ़ना')).toBe('चढना');
  });

  it('leaves non-nukta input unchanged', () => {
    expect(stripNukta('कहना')).toBe('कहना');
    expect(stripNukta('जाना')).toBe('जाना');
  });

  it('maps atomic precomposed nukta consonants to their base', () => {
    // Each entry uses the U+0958..U+095F (+ U+0929 ऩ) atomic codepoints.
    const cases: Array<[string, string]> = [
      ['क़ाम', 'काम'], // क़ाम → काम
      ['ख़ास', 'खास'], // ख़ास → खास
      ['ग़रीब', 'गरीब'], // ग़रीब → गरीब
      ['ज़रा', 'जरा'], // ज़रा → जरा
      ['ड़ा', 'डा'], // ड़ा → डा
      ['ढ़ा', 'ढा'], // ढ़ा → ढा
      ['फ़ल', 'फल'], // फ़ल → फल
      ['य़ा', 'या'], // य़ा → या
      ['ऩ', 'न'], // ऩ → न
    ];
    for (const [atomic, base] of cases) {
      expect(stripNukta(atomic)).toBe(base);
    }
  });

  it('handles both encodings on the same input identically', () => {
    // ज़रा encoded two ways: atomic U+095B vs base U+091C + U+093C.
    const atomic = 'ज़रा';
    const decomposed = 'ज़रा';
    expect(stripNukta(atomic)).toBe(stripNukta(decomposed));
    expect(stripNukta(atomic)).toBe('जरा');
  });

  it('strips every nukta in a multi-nukta word', () => {
    // ज़ख़्म "wound" — two nuktas. Encoded with atomic ज़ + ख़.
    expect(stripNukta('ज़ख़्म')).toBe('जख्म');
  });

  it('is the lossy-by-design tier: ज़रा and जरा collapse to the same key', () => {
    // The "did you mean" hint exists exactly because of this. Pinned
    // here so a future change can't quietly make the two distinguish.
    expect(stripNukta('ज़रा')).toBe(stripNukta('जरा'));
  });

  it('preserves non-Devanagari surrounding text', () => {
    // Mixed scripts come up in the curator search box (e.g. someone
    // pastes a romanized English gloss alongside a Hindi headword).
    expect(stripNukta('see पढ़ना (verb)')).toBe('see पढना (verb)');
  });

  it('returns empty string for empty / null-ish input', () => {
    expect(stripNukta('')).toBe('');
    // Defensive: the type signature is string but we want crashes
    // ruled out for callers that forget to check upstream.
    expect(stripNukta(undefined as unknown as string)).toBe('');
    expect(stripNukta(null as unknown as string)).toBe('');
  });

  it('is idempotent — stripping a stripped value yields the same string', () => {
    const once = stripNukta('पढ़ना');
    expect(stripNukta(once)).toBe(once);
  });

  it('produces NFC output (no leftover combining nukta)', () => {
    const result = stripNukta('ज़रा');
    expect(result).toBe(result.normalize('NFC'));
    expect(result.includes('़')).toBe(false);
  });
});

describe('hasNukta', () => {
  it('detects decomposed nukta', () => {
    expect(hasNukta('पढ़ना')).toBe(true);
  });

  it('detects atomic precomposed nukta consonants', () => {
    expect(hasNukta('ज़रा')).toBe(true); // ज़रा
    expect(hasNukta('ऩ')).toBe(true); // ऩ
  });

  it('returns false for nukta-free Devanagari', () => {
    expect(hasNukta('कहना')).toBe(false);
    expect(hasNukta('जरा')).toBe(false);
  });

  it('returns false for empty / null-ish input', () => {
    expect(hasNukta('')).toBe(false);
    expect(hasNukta(undefined as unknown as string)).toBe(false);
    expect(hasNukta(null as unknown as string)).toBe(false);
  });

  it('returns false for non-Devanagari text', () => {
    expect(hasNukta('hello world')).toBe(false);
  });
});

describe('stripNukta — Hebrew ligature folding (Yiddish)', () => {
  it('folds the ligature codepoints to letter pairs', () => {
    expect(stripNukta('װאַסער')).toBe('וואַסער');
    expect(stripNukta('הױז')).toBe('הויז');
    expect(stripNukta('צװײ')).toBe('צוויי');
  });

  it('folds ligature + pasekh onto the letter-pair pasekh form', () => {
    // שרײַבן (U+05F2 + pasekh) and שרייַבן (letter pair) must reduce
    // to the same key so either dictionary/typing convention matches.
    expect(stripNukta('שרײַבן')).toBe(stripNukta('שרייַבן'));
  });

  it('folds pasekh-on-first-yud onto pasekh-on-second-yud', () => {
    expect(stripNukta('שריַיבן')).toBe(stripNukta('שרייַבן'));
  });

  it('leaves canonical letter-pair text unchanged', () => {
    expect(stripNukta('וואַסער')).toBe('וואַסער');
    expect(stripNukta('ייִדיש')).toBe('ייִדיש');
  });

  it('does not trigger the lossy-fallback hint for ligature folding', () => {
    expect(hasNukta('װאַסער')).toBe(false);
    expect(hasNukta('שרײַבן')).toBe(false);
  });
});
