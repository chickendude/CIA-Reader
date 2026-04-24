import { describe, it, expect } from 'vitest';
import {
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
  isThemePreference,
  resolveTheme,
} from './index.js';

describe('resolveTheme', () => {
  it("returns 'light' when preference is 'light' regardless of system preference", () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('light', false)).toBe('light');
  });

  it("returns 'dark' when preference is 'dark' regardless of system preference", () => {
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it("follows system preference when preference is 'system'", () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('isThemePreference', () => {
  it('accepts the three valid preference strings', () => {
    expect(isThemePreference('system')).toBe(true);
    expect(isThemePreference('light')).toBe(true);
    expect(isThemePreference('dark')).toBe(true);
  });

  it('rejects other values', () => {
    expect(isThemePreference('auto')).toBe(false);
    expect(isThemePreference('')).toBe(false);
    expect(isThemePreference(undefined)).toBe(false);
    expect(isThemePreference(null)).toBe(false);
    expect(isThemePreference(0)).toBe(false);
    expect(isThemePreference({})).toBe(false);
  });
});

describe('theme cookie constants', () => {
  it('exposes a stable cookie name', () => {
    expect(THEME_COOKIE).toBe('cia_theme');
  });

  it('uses a one-year max-age', () => {
    expect(THEME_COOKIE_MAX_AGE).toBe(60 * 60 * 24 * 365);
  });
});
