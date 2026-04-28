/**
 * Current-language context (T-5.25).
 *
 * The "current language" is the script the user is actively reading
 * — what the home grid and library filter default to, and what the
 * rail indicator shows. It's a cookie-driven choice so:
 *   - signed-out visitors can browse a single language without
 *     setting up a session;
 *   - the picker can switch instantly on click without a full
 *     page reload;
 *   - switching across devices is independent (a per-tab feel that
 *     matches how learners juggle browsers / phones).
 *
 * The cookie is validated against either the supported-language
 * registry (anonymous) or the user's `user_languages` rows (signed
 * in) so a stale cookie can't pin the user to a language they don't
 * actually have data for.
 */
import {
  LANGUAGES,
  SUPPORTED_LANGUAGE_CODES,
  isSupportedLanguage,
  type LanguageCode,
} from '@ciareader/shared-types';

export const LANG_COOKIE = 'cia_lang';
export const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

/** Pick the current language given the cookie + the user's list of
 *  active language codes. Returns null when the user has no active
 *  languages (anonymous + no cookie, or signed-in with zero rows). */
export function resolveCurrentLanguage(
  cookieValue: string | undefined,
  activeCodes: readonly LanguageCode[],
): LanguageCode | null {
  // For signed-in users, only honor a cookie that matches an active
  // user_languages row.
  if (activeCodes.length > 0) {
    if (cookieValue && isSupportedLanguage(cookieValue)) {
      const code = cookieValue as LanguageCode;
      if (activeCodes.includes(code)) return code;
    }
    return activeCodes[0]!;
  }

  // Anonymous: any supported code works as the "current" pick. If
  // the cookie isn't valid, default to the first supported code.
  if (cookieValue && isSupportedLanguage(cookieValue)) {
    return cookieValue as LanguageCode;
  }
  return SUPPORTED_LANGUAGE_CODES[0] ?? null;
}

/** Compact descriptor passed to the client for rendering the rail
 *  indicator / picker. Keep small + serializable. */
export interface LanguageOption {
  code: LanguageCode;
  displayName: string;
  nativeName: string;
  /** Single-glyph icon — first character of `nativeName`. Lets the
   *  rail render a compact circular indicator without loading any
   *  per-script asset beyond the design's font stack. */
  glyph: string;
}

export function languageOption(code: LanguageCode): LanguageOption {
  const desc = LANGUAGES[code];
  return {
    code,
    displayName: desc.displayName,
    nativeName: desc.nativeName,
    glyph: [...desc.nativeName][0] ?? code.toUpperCase().slice(0, 1),
  };
}
