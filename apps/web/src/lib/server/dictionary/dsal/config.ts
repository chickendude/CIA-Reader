/**
 * Per-dictionary configuration for the DSAL scrape → parse → import
 * pipeline (Digital Dictionaries of South Asia, dsal.uchicago.edu).
 *
 * Everything dictionary-specific — CGI slug, enumeration alphabet,
 * native-script range, expected size — lives here so the scraper,
 * parser, and importers all read one table. The divergence between the
 * four dictionaries is scalar (strings and regexes), so plain config
 * objects beat subclassing; this mirrors how `makeKaikkiSource` takes
 * an options object per language.
 *
 * Enumeration model: the DSAL query CGI takes
 *   ?qs=<query>&searchhws=yes&matchtype=default
 * where `matchtype=default` means *beginning with* (verified against
 * the live search form's radio values: default | exact | endingwith |
 * containing) and returns EVERY match in one response — no pagination.
 * So one query per initial letter enumerates the whole dictionary.
 * Single codepoints suffice as initials (the server does raw string
 * prefix matching, so अं/क्ष-initial words are covered by अ/क); the
 * parse step's dedupe absorbs any overlap between queries.
 */

export const DSAL_SLUGS = [
  'dsal-molesworth',
  'dsal-vaze',
  'dsal-platts',
  'dsal-praharaj',
] as const;

export type DsalSlug = (typeof DSAL_SLUGS)[number];

export type DsalDictionaryConfig = {
  slug: DsalSlug;
  /** Path segment in the query CGI, e.g. `molesworth` → `/cgi-bin/app/molesworth_query.py`. */
  cgiSlug: string;
  language: 'hi' | 'mr' | 'or';
  /** ISO 15924 code of the headwords we import. */
  script: 'Deva' | 'Orya';
  /** Bibliographic citation, used in logs and docs. */
  citation: string;
  /** Initial characters queried with matchtype=default (beginning-with). */
  queryAlphabet: string[];
  /**
   * One-codepoint character class of the native script. Used to pick
   * the headword out of multi-script entry heads (Platts) and to
   * sanity-check parsed headwords.
   */
  scriptRange: RegExp;
  /**
   * Advisory bounds for the final deduped record count. The parse CLI
   * warns (never fails) outside this range — a scrape that lost letters
   * shows up here before anyone imports it.
   */
  expectedEntryCountRange: [number, number];
};

/** Devanagari initials shared by the two Marathi dictionaries. */
const DEVANAGARI_INITIALS = [
  'अ', 'आ', 'इ', 'ई', 'उ', 'ऊ', 'ऋ', 'ॠ', 'ऌ', 'ए', 'ऐ', 'ओ', 'औ', 'ऍ', 'ऑ',
  'क', 'ख', 'ग', 'घ', 'ङ', 'च', 'छ', 'ज', 'झ', 'ञ', 'ट', 'ठ', 'ड', 'ढ', 'ण',
  'त', 'थ', 'द', 'ध', 'न', 'प', 'फ', 'ब', 'भ', 'म', 'य', 'र', 'ल', 'व', 'श',
  'ष', 'स', 'ह', 'ळ',
];

/** Odia initials. ଡ଼/ଢ଼ decompose to ଡ/ଢ + nukta, so the base letters cover them. */
const ODIA_INITIALS = [
  'ଅ', 'ଆ', 'ଇ', 'ଈ', 'ଉ', 'ଊ', 'ଋ', 'ୠ', 'ଌ', 'ଏ', 'ଐ', 'ଓ', 'ଔ',
  'କ', 'ଖ', 'ଗ', 'ଘ', 'ଙ', 'ଚ', 'ଛ', 'ଜ', 'ଝ', 'ଞ', 'ଟ', 'ଠ', 'ଡ', 'ଢ', 'ଣ',
  'ତ', 'ଥ', 'ଦ', 'ଧ', 'ନ', 'ପ', 'ଫ', 'ବ', 'ଭ', 'ମ', 'ଯ', 'ୟ', 'ର', 'ଲ', 'ଳ',
  'ଵ', 'ୱ', 'ଶ', 'ଷ', 'ସ', 'ହ',
];

/**
 * Platts is enumerated along two axes: roman transliteration a–z (the
 * axis its search indexes headwords by) plus Perso-Arabic initials as a
 * second pass for headwords whose transliteration starts with a
 * diacritic form the roman axis might miss (ā, ṭ, …). The two sweeps
 * overlap heavily; dedupe handles it.
 */
const PLATTS_INITIALS = [
  ...'abcdefghijklmnopqrstuvwxyz'.split(''),
  'ا', 'آ', 'ب', 'پ', 'ت', 'ٹ', 'ث', 'ج', 'چ', 'ح', 'خ', 'د', 'ڈ', 'ذ',
  'ر', 'ڑ', 'ز', 'ژ', 'س', 'ش', 'ص', 'ض', 'ط', 'ظ', 'ع', 'غ', 'ف', 'ق',
  'ک', 'گ', 'ل', 'م', 'ن', 'و', 'ہ', 'ھ', 'ء', 'ی', 'ے',
];

const DEVA_RANGE = /[ऀ-ॿ]/;
const ORYA_RANGE = /[଀-୿]/;

export const DSAL_DICTIONARIES: Record<DsalSlug, DsalDictionaryConfig> = {
  'dsal-molesworth': {
    slug: 'dsal-molesworth',
    cgiSlug: 'molesworth',
    language: 'mr',
    script: 'Deva',
    citation: 'Molesworth, A Dictionary, Marathi and English (1857)',
    queryAlphabet: DEVANAGARI_INITIALS,
    scriptRange: DEVA_RANGE,
    expectedEntryCountRange: [50_000, 75_000],
  },
  'dsal-vaze': {
    slug: 'dsal-vaze',
    cgiSlug: 'vaze',
    language: 'mr',
    script: 'Deva',
    citation: 'Vaze, The Aryabhushan School Dictionary, Marathi–English (1911)',
    queryAlphabet: DEVANAGARI_INITIALS,
    scriptRange: DEVA_RANGE,
    expectedEntryCountRange: [15_000, 40_000],
  },
  'dsal-platts': {
    slug: 'dsal-platts',
    cgiSlug: 'platts',
    language: 'hi',
    script: 'Deva',
    citation: 'Platts, A Dictionary of Urdū, Classical Hindī, and English (1884)',
    queryAlphabet: PLATTS_INITIALS,
    scriptRange: DEVA_RANGE,
    // Post-skip count (entries with no Devanagari orthography are
    // dropped — see parse.ts); the full dictionary is ~55k entries and
    // the Devanagari share is measured by the parse CLI's skip stats.
    expectedEntryCountRange: [20_000, 60_000],
  },
  'dsal-praharaj': {
    slug: 'dsal-praharaj',
    cgiSlug: 'praharaj',
    language: 'or',
    script: 'Orya',
    citation: 'Praharaj, Purnnachandra Ordia Bhashakosha (1931–40)',
    queryAlphabet: ODIA_INITIALS,
    scriptRange: ORYA_RANGE,
    expectedEntryCountRange: [100_000, 200_000],
  },
};

export function findDsalConfig(slug: string): DsalDictionaryConfig | undefined {
  return (DSAL_DICTIONARIES as Record<string, DsalDictionaryConfig>)[slug];
}
