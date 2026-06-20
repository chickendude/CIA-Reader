/**
 * Kaikki English → Yiddish translations importer.
 *
 * Same inversion path as the Hindi/Marathi/Odia siblings, for Hebrew
 * script (ISO 15924 `Hebr`). English Wiktionary's Translations
 * sections list Yiddish targets well beyond the per-language Yiddish
 * sub-corpus, so this is the same coverage uplift it was for Odia.
 */
import { makeKaikkiEnTranslationsSource } from './kaikki-en-translations.js';

export const kaikkiEnTranslationsYiddishSource = makeKaikkiEnTranslationsSource({
  name: 'kaikki-en-translations-yiddish',
  targetLang: 'yi',
  script: 'Hebr',
  sourceIdPrefix: 'kaikki-en:yi',
  attribution: 'Wiktionary English (Translations sections) via Kaikki.org',
  license: 'CC-BY-SA-3.0',
});
