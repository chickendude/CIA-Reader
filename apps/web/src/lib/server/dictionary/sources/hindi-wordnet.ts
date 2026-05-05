/**
 * Hindi WordNet (CFILT IIT-Bombay) importer (T-3.10a).
 *
 * Thin instantiation of `makeIndoWordNetSource` — the parser, POS map,
 * and stream wrapper live in `indo-wordnet.ts`. Adding the Marathi
 * sibling (T-3.10c) and Odia (T-3.10f) is one more block each.
 *
 * Distribution requires CFILT registration; place the dump at
 * `apps/web/data/dictionaries/hindi-wordnet/synsets.tsv` and run
 * `pnpm dictionary:import hindi-wordnet`.
 */
import { makeIndoWordNetSource } from './indo-wordnet.js';

export const hindiWordnetSource = makeIndoWordNetSource({
  name: 'hindi-wordnet',
  language: 'hi',
  script: 'Deva',
  sourceIdPrefix: 'hwn',
  attribution:
    'Hindi WordNet, CFILT IIT-Bombay (research use; attribution required)',
  license: 'Custom-Research-Use',
  envVar: 'HINDI_WORDNET_FILE',
  defaultPath: 'data/dictionaries/hindi-wordnet/synsets.tsv',
});
