/**
 * Kaikki English → Hindi translations importer (T-3.10).
 *
 * Inverts the English Wiktionary's `translations[]` arrays to surface
 * Hindi headwords that appear as targets. Complements the per-language
 * Hindi dump (kaikki-hindi) which only sees what Wiktionary's Hindi
 * sub-corpus documents locally — the English Translations sections
 * are typically much richer.
 */
import { makeKaikkiEnTranslationsSource } from './kaikki-en-translations.js';

export const kaikkiEnTranslationsHindiSource = makeKaikkiEnTranslationsSource({
  name: 'kaikki-en-translations-hindi',
  targetLang: 'hi',
  script: 'Deva',
  sourceIdPrefix: 'kaikki-en:hi',
  attribution: 'Wiktionary English (Translations sections) via Kaikki.org',
  license: 'CC-BY-SA-3.0',
});
