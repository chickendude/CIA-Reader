/**
 * Kaikki Yiddish importer.
 *
 * Thin instantiation of `makeKaikkiSource`. Yiddish is the first
 * non-Indic language (ISO 15924 `Hebr`, right-to-left) — a clean test
 * that nothing in the import path assumes a Brahmic script.
 *
 * Coverage caveat: English Wiktionary's Yiddish corpus (~10k entries)
 * is solid on core vocabulary and uses standard YIVO orthography with
 * pointed letters and the װ/ױ/ײ ligature codepoints. The NLP lemma
 * lookups fold those ligatures, so headwords match however the reader's
 * text was typed. Like Odia, the per-language dump is complemented by
 * the English Translations-sections importer.
 */
import { makeKaikkiSource } from './kaikki.js';

export const kaikkiYiddishSource = makeKaikkiSource({
  name: 'kaikki-yiddish',
  language: 'yi',
  script: 'Hebr',
  sourceIdPrefix: 'kaikki:yi',
  attribution: 'Wiktionary Yiddish via Kaikki.org',
  license: 'CC-BY-SA-3.0',
  envVar: 'KAIKKI_YIDDISH_FILE',
  defaultPath: 'data/dictionaries/kaikki-yiddish/raw.jsonl',
});
