/**
 * Per-dictionary configuration for the transcription workbench.
 *
 * One entry per scan-backed dictionary: which language it belongs to,
 * how its imported draft rows are keyed (`draftSourceIdPrefix` — the
 * unverified queue is "lemmas with this prefix and not curator_locked"),
 * and the attribution stamped onto rows a curator has verified against
 * the public-domain scan. Scan *sources* (archive.org identifiers) are
 * recorded on `scan_volumes.source_url` at ingest time and in the
 * ledger (docs/dictionary-sources.md), not here.
 */
import type { LanguageCode } from '@ciareader/shared-types';

export type ScanDictionaryConfig = {
  /** Registry/importer slug, e.g. 'dsal-praharaj'. */
  slug: string;
  language: LanguageCode;
  script: string;
  /** Bibliographic citation used in attribution strings and UI labels. */
  citation: string;
  /** Imported draft rows' source_id prefix (see sources/dsal.ts). */
  draftSourceIdPrefix: string;
  /** Workbench-created entries' source_id prefix. */
  createdSourceIdPrefix: string;
};

export const SCAN_DICTIONARIES: Record<string, ScanDictionaryConfig> = {
  'dsal-molesworth': {
    slug: 'dsal-molesworth',
    language: 'mr',
    script: 'Deva',
    citation: 'Molesworth, A Dictionary, Marathi and English (1857)',
    draftSourceIdPrefix: 'dsal:molesworth:',
    createdSourceIdPrefix: 'transcribe:molesworth:',
  },
  'dsal-vaze': {
    slug: 'dsal-vaze',
    language: 'mr',
    script: 'Deva',
    citation: 'Vaze, The Aryabhushan School Dictionary, Marathi–English (1911)',
    draftSourceIdPrefix: 'dsal:vaze:',
    createdSourceIdPrefix: 'transcribe:vaze:',
  },
  'dsal-platts': {
    slug: 'dsal-platts',
    language: 'hi',
    script: 'Deva',
    citation: 'Platts, A Dictionary of Urdū, Classical Hindī, and English (1884)',
    draftSourceIdPrefix: 'dsal:platts:',
    createdSourceIdPrefix: 'transcribe:platts:',
  },
  'dsal-praharaj': {
    slug: 'dsal-praharaj',
    language: 'or',
    script: 'Orya',
    citation: 'Praharaj, Purnnachandra Ordia Bhashakosha (1931–40)',
    draftSourceIdPrefix: 'dsal:praharaj:',
    createdSourceIdPrefix: 'transcribe:praharaj:',
  },
};

export function findScanDictionary(slug: string): ScanDictionaryConfig | undefined {
  return SCAN_DICTIONARIES[slug];
}

/**
 * Attribution stamped onto a lemma the curator verified against the
 * scan. Deliberately does NOT mention DSAL: the verified text is the
 * curator's transcription of the public-domain printed page (the DSAL
 * draft was the starting point, the scan is the authority).
 */
export function verifiedAttribution(config: ScanDictionaryConfig, printedPage?: number | null): string {
  const page = printedPage ? `, p. ${printedPage}` : '';
  return `Transcribed from ${config.citation}${page}, from the public-domain scan — CIA Reader transcription`;
}
