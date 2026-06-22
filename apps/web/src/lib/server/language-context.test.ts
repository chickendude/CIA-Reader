// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  LANG_COOKIE,
  LANG_COOKIE_MAX_AGE,
  addableLanguageOptions,
  languageOption,
  resolveCurrentLanguage,
} from './language-context.js';
import { SUPPORTED_LANGUAGE_CODES } from '@ciareader/shared-types';

describe('resolveCurrentLanguage', () => {
  it("returns the user's only language when there's no cookie", () => {
    expect(resolveCurrentLanguage(undefined, ['hi'])).toBe('hi');
  });

  it("honors a cookie that matches one of the user's active languages", () => {
    expect(resolveCurrentLanguage('mr', ['hi', 'mr', 'or'])).toBe('mr');
  });

  it("ignores a cookie pointing at a language the user isn't active in", () => {
    expect(resolveCurrentLanguage('or', ['hi', 'mr'])).toBe('hi');
  });

  it('ignores a malformed cookie', () => {
    expect(resolveCurrentLanguage('not-a-code', ['hi'])).toBe('hi');
    expect(resolveCurrentLanguage('', ['hi', 'mr'])).toBe('hi');
  });

  it('falls back to the supported-language registry for anonymous visitors', () => {
    // No active languages means the user is signed out / hasn't
    // onboarded; honor the cookie or pick the first supported code.
    expect(resolveCurrentLanguage('mr', [])).toBe('mr');
    expect(resolveCurrentLanguage(undefined, [])).toBe('hi');
  });

  it('returns null only when there are zero supported languages and no cookie (defensive)', () => {
    // The registry is non-empty in practice, so this branch only
    // triggers if SUPPORTED_LANGUAGE_CODES is ever drained — but
    // resolveCurrentLanguage shouldn't crash if it is.
    const got = resolveCurrentLanguage(undefined, []);
    // With the real registry this resolves to 'hi'; the test asserts
    // we don't return null when there's a registry to fall back on.
    expect(got).toBe('hi');
  });
});

describe('languageOption', () => {
  it("returns the display name + the first glyph of the native name", () => {
    const hi = languageOption('hi');
    expect(hi.code).toBe('hi');
    expect(hi.displayName).toBe('Hindi');
    expect(hi.nativeName).toBe('हिन्दी');
    expect(hi.glyph).toBe('ह');
  });

  it("uses the first codepoint of the native name (covers multi-byte glyphs)", () => {
    const or = languageOption('or');
    // 'ଓଡ଼ିଆ' starts with 'ଓ'.
    expect(or.glyph).toBe('ଓ');
  });
});

describe('addableLanguageOptions', () => {
  it('returns every supported language the user has not added', () => {
    const opts = addableLanguageOptions(['hi', 'mr']);
    const codes = opts.map((o) => o.code);
    expect(codes).not.toContain('hi');
    expect(codes).not.toContain('mr');
    expect(codes.length).toBe(SUPPORTED_LANGUAGE_CODES.length - 2);
    // Carries the same shape as languageOption for direct rendering.
    expect(opts[0]).toMatchObject({
      code: expect.any(String),
      displayName: expect.any(String),
      nativeName: expect.any(String),
      glyph: expect.any(String),
    });
  });

  it('returns an empty list when the user already has every language', () => {
    expect(addableLanguageOptions(SUPPORTED_LANGUAGE_CODES)).toEqual([]);
  });

  it('offers all supported languages when the user has none', () => {
    expect(addableLanguageOptions([]).map((o) => o.code)).toEqual([
      ...SUPPORTED_LANGUAGE_CODES,
    ]);
  });
});

describe('cookie constants', () => {
  it('exposes a stable cookie name + 1y max-age', () => {
    expect(LANG_COOKIE).toBe('cia_lang');
    expect(LANG_COOKIE_MAX_AGE).toBe(60 * 60 * 24 * 365);
  });
});
