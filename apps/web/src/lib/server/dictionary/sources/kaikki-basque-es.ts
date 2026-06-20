/**
 * Kaikki Basque importer, Spanish-glossed (eu→es).
 *
 * Same Basque headwords as `kaikki-basque`, but sourced from the
 * **Spanish** Wiktionary edition (eswiktionary "Vasco" category) instead
 * of the English one, so the glosses are in Spanish. The wiktextract
 * JSONL schema is identical across editions, so `makeKaikkiSource` does
 * all the work — only `glossLanguage` and the source identity differ.
 *
 * This gives Basque learners who read Spanish a public, CC-BY-SA
 * definition set alongside the English one (T-… Basque dictionary).
 */
import { makeKaikkiSource } from './kaikki.js';

export const kaikkiBasqueEsSource = makeKaikkiSource({
  name: 'kaikki-basque-es',
  language: 'eu',
  script: 'Latn',
  // Distinct prefix so eu→es rows never collide with eu→en ones in the
  // (language, source, source_id) idempotency key.
  sourceIdPrefix: 'kaikki:eu-es',
  attribution: 'Wiktionary Spanish (eswiktionary) via Kaikki.org',
  license: 'CC-BY-SA-3.0',
  glossLanguage: 'es',
  envVar: 'KAIKKI_BASQUE_ES_FILE',
  defaultPath: 'data/dictionaries/kaikki-basque-es/raw.jsonl',
});
