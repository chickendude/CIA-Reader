/**
 * Language registry — the single source of truth for every script-aware
 * decision in the system. Consumers: NLP pipelines (services/nlp), the
 * <ScriptAwareInput> component, font shortlists in the reader, transliteration
 * wrappers. Adding a new language happens here first, then everything else
 * follows from the registry.
 *
 * Rule: nothing else in the codebase may hardcode "Devanagari" or any script.
 * If a UI asks "what's the target script?", the answer comes from here.
 */

// ISO 639-1 language codes we support (MVP + near-term).
export type LanguageCode = 'hi' | 'mr' | 'or' | 'yi' | 'eu';

// ISO 15924 script codes. Kept explicit so Urdu/Sindhi (multi-script) can be
// modeled cleanly later without retrofitting.
export type ScriptCode =
  | 'Deva'
  | 'Orya'
  | 'Beng'
  | 'Guru'
  | 'Gujr'
  | 'Arab'
  | 'Hebr'
  | 'Latn';

export type RomanizationScheme =
  | 'iso15919'
  | 'iast'
  | 'hunterian'
  | 'itrans'
  | 'velthuis'
  | 'yivo';

export type TextDirection = 'ltr' | 'rtl';

export interface LanguageDescriptor {
  code: LanguageCode;
  displayName: string; // English display ("Hindi")
  nativeName: string; // Native-script name ("हिन्दी")
  nativeDictionaryTitle: string;
  script: ScriptCode;
  textDirection: TextDirection;
  supportedRomanizations: RomanizationScheme[];
  // Optional: Latin-script languages (e.g. Basque) need no romanization layer —
  // the text is already Latin. When `supportedRomanizations` is empty this is
  // omitted, and the reader hides its romanization controls entirely.
  defaultRomanization?: RomanizationScheme;
  recommendedFonts: string[]; // Font-family names, shortlist for the reader settings.
  pipelineId: string;
  notes?: string;
}

export const LANGUAGES: Readonly<Record<LanguageCode, LanguageDescriptor>> = {
  hi: {
    code: 'hi',
    displayName: 'Hindi',
    nativeName: 'हिन्दी',
    nativeDictionaryTitle: 'हिन्दी शब्दकोश',
    script: 'Deva',
    textDirection: 'ltr',
    supportedRomanizations: ['iso15919', 'iast', 'hunterian', 'itrans'],
    defaultRomanization: 'iso15919',
    recommendedFonts: [
      'Noto Serif Devanagari',
      'Noto Sans Devanagari',
      'Tiro Devanagari Hindi',
      'Mukta',
    ],
    pipelineId: 'hindidb-hi',
  },
  mr: {
    code: 'mr',
    displayName: 'Marathi',
    nativeName: 'मराठी',
    nativeDictionaryTitle: 'मराठी शब्दकोश',
    script: 'Deva',
    textDirection: 'ltr',
    supportedRomanizations: ['iso15919', 'iast', 'hunterian', 'itrans'],
    defaultRomanization: 'iso15919',
    recommendedFonts: [
      'Noto Serif Devanagari',
      'Noto Sans Devanagari',
      'Tiro Devanagari Marathi',
      'Mukta',
    ],
    pipelineId: 'dictionary-mr',
  },
  or: {
    code: 'or',
    displayName: 'Odia',
    nativeName: 'ଓଡ଼ିଆ',
    nativeDictionaryTitle: 'ଓଡ଼ିଆ ଅଭିଧାନ',
    script: 'Orya',
    textDirection: 'ltr',
    supportedRomanizations: ['iso15919', 'iast', 'itrans'],
    defaultRomanization: 'iso15919',
    recommendedFonts: ['Noto Sans Oriya', 'Noto Serif Oriya', 'Lohit Odia'],
    pipelineId: 'dictionary-or',
  },
  yi: {
    code: 'yi',
    displayName: 'Yiddish',
    nativeName: 'ייִדיש',
    nativeDictionaryTitle: 'ייִדיש ווערטערבוך',
    script: 'Hebr',
    textDirection: 'rtl',
    supportedRomanizations: ['yivo'],
    defaultRomanization: 'yivo',
    recommendedFonts: [
      'Noto Serif Hebrew',
      'Noto Sans Hebrew',
      'David Libre',
      'Frank Ruhl Libre',
    ],
    pipelineId: 'dictionary-yi',
  },
  eu: {
    code: 'eu',
    displayName: 'Basque',
    nativeName: 'Euskara',
    nativeDictionaryTitle: 'Euskal hiztegia',
    script: 'Latn',
    textDirection: 'ltr',
    // First Latin-script language: the text is already Latin, so there is no
    // romanization layer. An empty list disables the reader's romanization UI.
    supportedRomanizations: [],
    recommendedFonts: ['Noto Serif', 'Noto Sans', 'Source Serif 4', 'Georgia'],
    pipelineId: 'dictionary-eu',
  },
} as const;

export const SUPPORTED_LANGUAGE_CODES: readonly LanguageCode[] = Object.keys(
  LANGUAGES,
) as LanguageCode[];

export function getLanguage(code: LanguageCode): LanguageDescriptor {
  return LANGUAGES[code];
}

export function isSupportedLanguage(value: string): value is LanguageCode {
  return Object.prototype.hasOwnProperty.call(LANGUAGES, value);
}
