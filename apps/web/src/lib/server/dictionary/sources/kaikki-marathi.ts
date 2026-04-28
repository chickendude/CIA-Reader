/**
 * Kaikki Marathi importer (T-3.10).
 *
 * Thin instantiation of `makeKaikkiSource`. Marathi shares Devanagari
 * with Hindi so the script identifier is the same; only the dump URL,
 * file path, env var, and source_id prefix differ.
 *
 * Coverage caveat: Wiktionary's Marathi corpus is materially thinner
 * than Hindi's, so this importer alone won't be enough — it lands as
 * one of several Marathi sources alongside Marathi WordNet (CFILT) and
 * Molesworth (DSAL) per docs/dictionary-sources.md.
 */
import { makeKaikkiSource } from './kaikki.js';

export const kaikkiMarathiSource = makeKaikkiSource({
  name: 'kaikki-marathi',
  language: 'mr',
  script: 'Deva',
  sourceIdPrefix: 'kaikki:mr',
  attribution: 'Wiktionary Marathi via Kaikki.org',
  license: 'CC-BY-SA-3.0',
  envVar: 'KAIKKI_MARATHI_FILE',
  defaultPath: 'data/dictionaries/kaikki-marathi/raw.jsonl',
});
