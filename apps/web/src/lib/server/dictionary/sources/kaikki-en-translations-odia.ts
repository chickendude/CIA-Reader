/**
 * Kaikki English → Odia translations importer (T-3.10).
 *
 * Same inversion path as the Hindi/Marathi siblings, but for the
 * Odia script (ISO 15924 `Orya`). The English-side Translations
 * sections give substantially better Odia coverage than Wiktionary's
 * tiny Odia sub-corpus, so this is the single biggest Odia coverage
 * uplift available without licensing complications.
 */
import { makeKaikkiEnTranslationsSource } from './kaikki-en-translations.js';

export const kaikkiEnTranslationsOdiaSource = makeKaikkiEnTranslationsSource({
  name: 'kaikki-en-translations-odia',
  targetLang: 'or',
  script: 'Orya',
  sourceIdPrefix: 'kaikki-en:or',
  attribution: 'Wiktionary English (Translations sections) via Kaikki.org',
  license: 'CC-BY-SA-3.0',
});
