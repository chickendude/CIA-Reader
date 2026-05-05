/**
 * Dbnary Hindi-English importer (T-3.10b).
 *
 * Thin instantiation of `makeDbnarySource` — the Turtle parser, POS
 * map, and stream wrapper live in `dbnary.ts`. Adding the Marathi
 * sibling (T-3.10e) is one more block.
 */
import { makeDbnarySource } from './dbnary.js';

export const dbnaryHindiSource = makeDbnarySource({
  name: 'dbnary-hi',
  language: 'hi',
  script: 'Deva',
  sourceIdPrefix: 'dbnary:hi',
  attribution: 'Dbnary Hindi (GETALP / Univ. Grenoble Alpes)',
  license: 'CC-BY-SA-3.0',
  envVar: 'DBNARY_HINDI_FILE',
  defaultPath: 'data/dictionaries/dbnary-hi/raw.ttl',
  headwordLang: 'hi',
  translationLang: 'en',
});
