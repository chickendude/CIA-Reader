/**
 * Dbnary Marathi-English importer (T-3.10e).
 *
 * Sibling of `dbnary-hi.ts` — same shared Turtle parser, different
 * upstream language tag and on-disk default path. Adding more
 * Indo-Aryan languages from Dbnary (Bengali, Punjabi, …) is one more
 * block once those land in the registry.
 */
import { makeDbnarySource } from './dbnary.js';

export const dbnaryMarathiSource = makeDbnarySource({
  name: 'dbnary-mr',
  language: 'mr',
  script: 'Deva',
  sourceIdPrefix: 'dbnary:mr',
  attribution: 'Dbnary Marathi (GETALP / Univ. Grenoble Alpes)',
  license: 'CC-BY-SA-3.0',
  envVar: 'DBNARY_MARATHI_FILE',
  defaultPath: 'data/dictionaries/dbnary-mr/raw.ttl',
  headwordLang: 'mr',
  translationLang: 'en',
});
