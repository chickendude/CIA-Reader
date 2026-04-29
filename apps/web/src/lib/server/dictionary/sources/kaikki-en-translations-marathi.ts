/**
 * Kaikki English → Marathi translations importer (T-3.10).
 *
 * Same inversion path as the Hindi sibling. Marathi coverage on
 * Wiktionary's English-side Translations sections is materially
 * richer than its Marathi-side sub-corpus, so this importer is the
 * single biggest Marathi coverage uplift available without
 * licensing complications.
 */
import { makeKaikkiEnTranslationsSource } from './kaikki-en-translations.js';

export const kaikkiEnTranslationsMarathiSource = makeKaikkiEnTranslationsSource({
  name: 'kaikki-en-translations-marathi',
  targetLang: 'mr',
  script: 'Deva',
  sourceIdPrefix: 'kaikki-en:mr',
  attribution: 'Wiktionary English (Translations sections) via Kaikki.org',
  license: 'CC-BY-SA-3.0',
});
