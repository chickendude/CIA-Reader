import { describe, expect, it } from 'vitest';

import {
  LANGUAGES,
  SUPPORTED_LANGUAGE_CODES,
  getLanguage,
  isSupportedLanguage,
  type LanguageCode,
} from '@ciareader/shared-types';

describe('language registry (shared-types)', () => {
  it('lists every declared code in SUPPORTED_LANGUAGE_CODES', () => {
    expect(new Set(SUPPORTED_LANGUAGE_CODES)).toEqual(new Set(Object.keys(LANGUAGES)));
  });

  it('every descriptor matches its map key (no drift)', () => {
    for (const code of SUPPORTED_LANGUAGE_CODES) {
      expect(LANGUAGES[code].code).toBe(code);
    }
  });

  it('every descriptor has at least one recommended font and one romanization', () => {
    for (const code of SUPPORTED_LANGUAGE_CODES) {
      const descriptor = LANGUAGES[code];
      expect(descriptor.recommendedFonts.length).toBeGreaterThan(0);
      expect(descriptor.supportedRomanizations.length).toBeGreaterThan(0);
      expect(descriptor.supportedRomanizations).toContain(descriptor.defaultRomanization);
    }
  });

  it('MVP languages declare the expected ISO 15924 scripts (no Devanagari hardcoding for Odia)', () => {
    expect(LANGUAGES.hi.script).toBe('Deva');
    expect(LANGUAGES.mr.script).toBe('Deva');
    expect(LANGUAGES.or.script).toBe('Orya');
  });

  it('getLanguage() returns the descriptor for a valid code', () => {
    expect(getLanguage('hi').displayName).toBe('Hindi');
  });

  it('isSupportedLanguage() narrows correctly', () => {
    expect(isSupportedLanguage('hi')).toBe(true);
    expect(isSupportedLanguage('xx')).toBe(false);
    const value: unknown = 'mr';
    if (isSupportedLanguage(value as string)) {
      const narrowed: LanguageCode = value as LanguageCode;
      expect(narrowed).toBe('mr');
    }
  });
});
