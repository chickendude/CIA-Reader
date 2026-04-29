/**
 * Kaikki Odia importer (T-3.10).
 *
 * Thin instantiation of `makeKaikkiSource`. Odia uses the Odia script
 * (ISO 15924 `Orya`), the only MVP language that doesn't use
 * Devanagari — a clean test that the script-aware path doesn't
 * silently default anything to `Deva`.
 *
 * Coverage caveat: Wiktionary's Odia corpus is the thinnest of the
 * three MVP languages. This importer alone won't be enough — Odia
 * WordNet (ISI Kolkata) lands in a follow-up PR per
 * docs/dictionary-sources.md, and the browse page already carries the
 * `coverage: sparse` notice users see at launch.
 */
import { makeKaikkiSource } from './kaikki.js';

export const kaikkiOdiaSource = makeKaikkiSource({
  name: 'kaikki-odia',
  language: 'or',
  script: 'Orya',
  sourceIdPrefix: 'kaikki:or',
  attribution: 'Wiktionary Odia via Kaikki.org',
  license: 'CC-BY-SA-3.0',
  envVar: 'KAIKKI_ODIA_FILE',
  defaultPath: 'data/dictionaries/kaikki-odia/raw.jsonl',
});
