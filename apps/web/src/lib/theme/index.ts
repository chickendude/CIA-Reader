/**
 * Theme resolution. Source of truth for how a user preference
 * ('system' | 'light' | 'dark') combines with the OS/browser's
 * `prefers-color-scheme` to produce the concrete theme applied as a
 * `data-theme` attribute on `<html>`.
 *
 * Kept pure so both server-side rendering (to avoid a light-mode flash on
 * dark-mode users' first paint) and client-side onMount code (to react to
 * OS preference changes) can share it.
 */
export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
  return preference;
}

export const THEME_COOKIE = 'cia_theme';
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}
