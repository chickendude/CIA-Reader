/**
 * Kaikki Basque importer.
 *
 * Thin instantiation of `makeKaikkiSource`. Basque is the first
 * Latin-script language (ISO 15924 `Latn`) — a clean test that nothing
 * in the import path assumes a non-Latin script (no transliteration,
 * no script-fold fallback).
 *
 * Coverage caveat: English Wiktionary's Basque corpus is solid on core
 * vocabulary. Like the other languages, the per-language dump is
 * complemented by the English Translations-sections importer
 * (`kaikki-en-translations-basque`).
 */
import { makeKaikkiSource } from './kaikki.js';

export const kaikkiBasqueSource = makeKaikkiSource({
  name: 'kaikki-basque',
  language: 'eu',
  script: 'Latn',
  sourceIdPrefix: 'kaikki:eu',
  attribution: 'Wiktionary Basque via Kaikki.org',
  license: 'CC-BY-SA-3.0',
  envVar: 'KAIKKI_BASQUE_FILE',
  defaultPath: 'data/dictionaries/kaikki-basque/raw.jsonl',
});
