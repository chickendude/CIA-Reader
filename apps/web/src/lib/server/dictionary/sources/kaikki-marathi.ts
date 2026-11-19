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
