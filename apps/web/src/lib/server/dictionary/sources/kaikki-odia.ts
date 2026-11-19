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
