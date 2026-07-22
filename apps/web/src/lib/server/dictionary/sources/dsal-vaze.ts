/**
 * Vaze (DSAL) Marathi–English importer.
 *
 * *The Aryabhushan School Dictionary* (1911) — a concise
 * Marathi–English school dictionary, public domain, digitized by the
 * Digital Dictionaries of South Asia. The modern, single-line glosses
 * complement Molesworth's exhaustive but archaic 1857 entries; both
 * coexist per the non-unique `(language, headword, pos)` design and
 * get reconciled by curators where they overlap.
 *
 * Acquired via `pnpm dsal:scrape dsal-vaze && pnpm dsal:parse dsal-vaze`.
 */
import { MARATHI_POS_MAP, makeDsalSource, marathiSpellingVariants } from './dsal.js';

export const dsalVazeSource = makeDsalSource({
  name: 'dsal-vaze',
  language: 'mr',
  script: 'Deva',
  attribution:
    'Vaze, The Aryabhushan School Dictionary, Marathi–English (1911), via DSAL, University of Chicago — public domain',
  license: 'PublicDomain',
  posMap: MARATHI_POS_MAP,
  formVariants: marathiSpellingVariants,
  envVar: 'DSAL_VAZE_FILE',
  defaultPath: 'data/dictionaries/dsal-vaze/raw.jsonl',
});
