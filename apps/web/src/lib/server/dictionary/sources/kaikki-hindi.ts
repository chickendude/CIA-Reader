/**
 * Kaikki Hindi importer (T-3.10).
 *
 * Thin instantiation of `makeKaikkiSource` — the parser, POS map,
 * gloss-hashing, and stream wrapper all live in `kaikki.ts` so adding
 * Marathi / Odia / Punjabi is one more config block.
 */
import { makeKaikkiSource } from './kaikki.js';

export const kaikkiHindiSource = makeKaikkiSource({
  name: 'kaikki-hindi',
  language: 'hi',
  script: 'Deva',
  sourceIdPrefix: 'kaikki:hi',
  attribution: 'Wiktionary Hindi via Kaikki.org',
  license: 'CC-BY-SA-3.0',
  envVar: 'KAIKKI_HINDI_FILE',
  defaultPath: 'data/dictionaries/kaikki-hindi/raw.jsonl',
});
