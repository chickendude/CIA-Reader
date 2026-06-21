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

  it('every descriptor has at least one recommended font', () => {
    for (const code of SUPPORTED_LANGUAGE_CODES) {
      expect(LANGUAGES[code].recommendedFonts.length).toBeGreaterThan(0);
    }
  });

  it('romanization defaults are consistent with the supported list', () => {
    for (const code of SUPPORTED_LANGUAGE_CODES) {
      const descriptor = LANGUAGES[code];
      if (descriptor.supportedRomanizations.length > 0) {
        expect(descriptor.defaultRomanization).toBeDefined();
        expect(descriptor.supportedRomanizations).toContain(descriptor.defaultRomanization);
      } else {
        // Latin-script languages (Basque) declare no romanization layer.
        expect(descriptor.defaultRomanization).toBeUndefined();
      }
    }
  });

  it('MVP languages declare the expected ISO 15924 scripts (no Devanagari hardcoding for Odia)', () => {
    expect(LANGUAGES.hi.script).toBe('Deva');
    expect(LANGUAGES.mr.script).toBe('Deva');
    expect(LANGUAGES.or.script).toBe('Orya');
  });

  it('Basque (eu) is Latin-script, ltr, Stanza-backed, with no romanization', () => {
    expect(LANGUAGES.eu.script).toBe('Latn');
    expect(LANGUAGES.eu.textDirection).toBe('ltr');
    expect(LANGUAGES.eu.pipelineId).toBe('stanza-eu');
    expect(LANGUAGES.eu.supportedRomanizations).toEqual([]);
    expect(LANGUAGES.eu.defaultRomanization).toBeUndefined();
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
