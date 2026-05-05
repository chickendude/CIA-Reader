/**
 * Marathi WordNet (CFILT IIT-Bombay) importer (T-3.10c).
 *
 * Sibling of `hindi-wordnet.ts` — same shared CFILT TSV parser, just
 * a different language tag, sourceId prefix, and on-disk default path.
 * Distribution requires CFILT registration; place the dump at
 * `apps/web/data/dictionaries/marathi-wordnet/synsets.tsv` and run
 * `pnpm dictionary:import marathi-wordnet`.
 */
import { makeIndoWordNetSource } from './indo-wordnet.js';

export const marathiWordnetSource = makeIndoWordNetSource({
  name: 'marathi-wordnet',
  language: 'mr',
  script: 'Deva',
  sourceIdPrefix: 'mwn',
  attribution:
    'Marathi WordNet, CFILT IIT-Bombay (research use; attribution required)',
  license: 'Custom-Research-Use',
  envVar: 'MARATHI_WORDNET_FILE',
  defaultPath: 'data/dictionaries/marathi-wordnet/synsets.tsv',
});
