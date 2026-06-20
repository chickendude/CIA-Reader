/**
 * Definition-language helpers for the reader popup (Basque dictionary).
 *
 * A lemma's translations each carry a `targetLanguage` — the language the
 * gloss is *written in*. Basque ships glosses in English, Spanish, and
 * (over time) monolingual Basque, so the popup shows a per-language filter
 * so the reader can hide the languages they don't read.
 *
 * The display names live here rather than in `@ciareader/shared-types`
 * `LANGUAGES` because that registry only holds *reading* languages
 * (hi/mr/or/yi/eu) — `en` and `es` are gloss-only and have no registry
 * entry. Reading languages are included for the rare cross-glossed lemma.
 */

export const DEFINITION_LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  eu: 'Euskara',
  hi: 'Hindi',
  mr: 'Marathi',
  or: 'Odia',
  yi: 'Yiddish',
};

export function definitionLanguageName(code: string): string {
  return DEFINITION_LANGUAGE_NAMES[code] ?? code.toUpperCase();
}

/**
 * localStorage key for the reader's hidden-definition-language set. A pure
 * display preference (no migration, not cross-device) — the stored value is
 * a JSON array of the hidden language codes.
 */
export const HIDDEN_DEFINITION_LANGUAGES_KEY =
  'ciareader:hidden-definition-languages';

/** Parse the persisted set, tolerant of a missing or malformed value. */
export function parseHiddenDefinitionLanguages(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

export function serializeHiddenDefinitionLanguages(hidden: Set<string>): string {
  return JSON.stringify([...hidden]);
}
