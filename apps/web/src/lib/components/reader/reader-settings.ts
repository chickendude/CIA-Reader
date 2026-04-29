/**
 * Reader settings — types + helpers (T-5.1b).
 *
 * The reader popover (`ReaderSettings.svelte`) and the reader page
 * loader both speak this shape. Defaults match the
 * `user_languages` column defaults so a brand-new (user, language)
 * pair gets a coherent reader before they ever touch the popover.
 */
import {
  LANGUAGES,
  type LanguageCode,
  type RomanizationScheme,
} from '@ciareader/shared-types';

export type ReaderLayoutMode = 'page' | 'paged_scroll' | 'continuous';
export type HighlightStyle = 'underline' | 'background' | 'colored_text';
export type ReadingWidth = 'narrow' | 'medium' | 'wide';
export type ScriptPreference =
  | 'native'
  | 'native_with_romanization'
  | 'romanization_only';

export interface ReaderSettings {
  readerLayoutMode: ReaderLayoutMode;
  wordsPerPage: number;
  fontFamily: string | null;
  fontSize: number;
  lineSpacing: number;
  highlightStyle: HighlightStyle;
  readingWidth: ReadingWidth;
  scriptPreference: ScriptPreference;
  romanizationScheme: RomanizationScheme;
}

export const FONT_SIZE_MIN = 14;
export const FONT_SIZE_MAX = 28;
export const LINE_SPACING_MIN = 1.2;
export const LINE_SPACING_MAX = 2.2;
export const WORDS_PER_PAGE_MIN = 50;
export const WORDS_PER_PAGE_MAX = 1000;

/** Match the user_languages column defaults so an unauth'd reader,
 *  or a user who hasn't customized this language, gets a sensible
 *  starting point. */
export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  readerLayoutMode: 'page',
  wordsPerPage: 250,
  fontFamily: null,
  fontSize: 18,
  lineSpacing: 1.6,
  highlightStyle: 'background',
  readingWidth: 'medium',
  scriptPreference: 'native',
  romanizationScheme: 'iso15919',
};

/** Map readingWidth → reader-page max-width in rem. The reader's
 *  `--reader-col-width` CSS variable consumes this. */
export const READING_WIDTH_REM: Record<ReadingWidth, number> = {
  narrow: 32,
  medium: 40,
  wide: 56,
};

/** Pull the language's recommended-fonts shortlist from the shared
 *  registry. Always includes a `null` (system default) at the head so
 *  the popover can offer "use the script's default". */
export function recommendedFontsFor(language: LanguageCode): Array<string | null> {
  const list = LANGUAGES[language].recommendedFonts;
  return [null, ...list];
}

/** Clamp a numeric setting into its allowed range. Used when the
 *  popover hands a slider value back so a coercion bug never
 *  persists an out-of-range row. */
export function clampReaderSettings(s: ReaderSettings): ReaderSettings {
  return {
    ...s,
    fontSize: Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, s.fontSize)),
    lineSpacing: Math.min(
      LINE_SPACING_MAX,
      Math.max(LINE_SPACING_MIN, s.lineSpacing),
    ),
    wordsPerPage: Math.min(
      WORDS_PER_PAGE_MAX,
      Math.max(WORDS_PER_PAGE_MIN, Math.round(s.wordsPerPage)),
    ),
  };
}

/** Diff two settings objects — returns only the fields that changed.
 *  The popover uses this to send partial PATCH bodies, so the
 *  default-only path stays a no-op. */
export function settingsDiff(
  prev: ReaderSettings,
  next: ReaderSettings,
): Partial<ReaderSettings> {
  const out: Partial<ReaderSettings> = {};
  (Object.keys(next) as Array<keyof ReaderSettings>).forEach((k) => {
    if (prev[k] !== next[k]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (out as any)[k] = next[k];
    }
  });
  return out;
}
