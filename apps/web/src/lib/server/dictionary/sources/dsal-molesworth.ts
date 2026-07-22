/**
 * Molesworth (DSAL) Marathi–English importer.
 *
 * *A Dictionary, Marathi and English* (2nd ed., 1857) — the most
 * comprehensive Marathi–English dictionary ever produced (~60k
 * entries), public domain, digitized by the Digital Dictionaries of
 * South Asia. Acquired via `pnpm dsal:scrape dsal-molesworth &&
 * pnpm dsal:parse dsal-molesworth` (see docs/dictionary-sources.md,
 * "DSAL scraping").
 *
 * Headwords keep Molesworth's 1857 orthography (NFC-normalized only);
 * the nukta-stripped matching tier absorbs the most common archaic
 * variants, and a curator-reviewed spelling-fixup table can plug into
 * the factory's `normalizer` seam later without changing source_ids.
 */
import { MARATHI_POS_MAP, makeDsalSource } from './dsal.js';

export const dsalMolesworthSource = makeDsalSource({
  name: 'dsal-molesworth',
  language: 'mr',
  script: 'Deva',
  attribution:
    'Molesworth, A Dictionary, Marathi and English (1857), via DSAL, University of Chicago — public domain',
  license: 'PublicDomain',
  posMap: MARATHI_POS_MAP,
  envVar: 'DSAL_MOLESWORTH_FILE',
  defaultPath: 'data/dictionaries/dsal-molesworth/raw.jsonl',
});
