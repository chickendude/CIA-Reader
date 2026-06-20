/**
 * Kaikki English → Basque translations importer.
 *
 * Same inversion path as the Hindi/Marathi/Odia/Yiddish siblings, for
 * Latin script (ISO 15924 `Latn`). English Wiktionary's Translations
 * sections list Basque targets beyond the per-language Basque
 * sub-corpus, so this is the same coverage uplift it is for the others.
 */
import { makeKaikkiEnTranslationsSource } from './kaikki-en-translations.js';

export const kaikkiEnTranslationsBasqueSource = makeKaikkiEnTranslationsSource({
  name: 'kaikki-en-translations-basque',
  targetLang: 'eu',
  script: 'Latn',
  sourceIdPrefix: 'kaikki-en:eu',
  attribution: 'Wiktionary English (Translations sections) via Kaikki.org',
  license: 'CC-BY-SA-3.0',
});
