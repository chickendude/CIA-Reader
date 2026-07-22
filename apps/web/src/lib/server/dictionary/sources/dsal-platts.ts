/**
 * Platts (DSAL) importer — *A Dictionary of Urdū, Classical Hindī, and
 * English* (1884), public domain, imported as **Hindi** (`hi`).
 *
 * Platts prints headwords in Perso-Arabic, roman, and (for
 * Indic-origin vocabulary) Devanagari. We import through the
 * Devanagari orthography: the parse step (dsal/parse.ts) keeps only
 * entries carrying a `<d>` Devanagari headword — a Devanagari reader
 * can't match the rest — and reports the skip percentage so the
 * coverage loss is measured, not guessed. The Perso-Arabic spelling
 * survives in the record's `hwAlt` (JSONL only; never emitted as a
 * form, where it would pollute native-script surface matching).
 *
 * Coverage caveat: 1884 "classical Hindi" skews literary/Persianate.
 * This lands as one of several Hindi sources next to Kaikki, filling
 * the gap left by rejecting the modern DSAL Hindi dictionaries (all
 * still in copyright — see docs/dictionary-sources.md).
 *
 * Acquired via `pnpm dsal:scrape dsal-platts && pnpm dsal:parse dsal-platts`.
 */
import { PLATTS_POS_MAP, makeDsalSource } from './dsal.js';

export const dsalPlattsSource = makeDsalSource({
  name: 'dsal-platts',
  language: 'hi',
  script: 'Deva',
  attribution:
    'Platts, A Dictionary of Urdū, Classical Hindī, and English (1884), via DSAL, University of Chicago — public domain',
  license: 'PublicDomain',
  posMap: PLATTS_POS_MAP,
  envVar: 'DSAL_PLATTS_FILE',
  defaultPath: 'data/dictionaries/dsal-platts/raw.jsonl',
});
