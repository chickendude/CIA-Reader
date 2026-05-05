/**
 * Odia WordNet (ISI Kolkata) importer (T-3.10f).
 *
 * The ISI Kolkata Odia WordNet ships in the same CFILT-style TSV
 * synset format as Hindi/Marathi WordNet (T-3.10a/c), so the
 * importer is a thin instantiation of `makeIndoWordNetSource`. The
 * `services/nlp/app/pipelines/odia` seed parser handles a tiny
 * subset of this same dump for tokenizer bootstrap; this importer
 * lets us pull the full WordNet into the dictionary database without
 * routing through the NLP service.
 *
 * Distribution requires registration with ISI Kolkata; place the
 * dump at `apps/web/data/dictionaries/odia-wordnet/synsets.tsv` and
 * run `pnpm dictionary:import odia-wordnet`. Coverage is sparser than
 * Hindi or Marathi (the browse page already flags this) — combining
 * with the OdiaNLP curated subset (T-3.10g) is the path to better
 * launch coverage.
 */
import { makeIndoWordNetSource } from './indo-wordnet.js';

export const odiaWordnetSource = makeIndoWordNetSource({
  name: 'odia-wordnet',
  language: 'or',
  script: 'Orya',
  sourceIdPrefix: 'own',
  attribution:
    'Odia WordNet, ISI Kolkata (research use; attribution required)',
  license: 'Custom-Research-Use',
  envVar: 'ODIA_WORDNET_FILE',
  defaultPath: 'data/dictionaries/odia-wordnet/synsets.tsv',
});
