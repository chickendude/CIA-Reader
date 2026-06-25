/**
 * Look-up results for a clicked/hovered word.
 *
 * `LookupResult` is the fast, mostly-local part: the resolved dictionary-form
 * lemma(s) and matching internal-dictionary entries (offline). External
 * reference-dictionary entries (Elhuyar eu-es/eu-en + Euskaltzaindia) are fetched
 * separately (backend scrapers, IndexedDB-cached) and represented by
 * `ReferenceEntry`.
 */
import type { ExportedLemma } from './api-types';

export type ReferenceSource = 'elhuyar_es' | 'elhuyar_en' | 'euskaltzaindia';

export type ReferenceEntry = {
  source: ReferenceSource;
  label: string;
  headword: string;
  pos: string;
  definition: string;
  examples: string[];
  url: string;
};

export type LookupResult = {
  surface: string;
  lemmas: string[];
  entries: ExportedLemma[];
};

/** Definition language a source/translation belongs to (for the EN/ES/EU filter). */
export type DefinitionLang = 'en' | 'es' | 'eu';

export function referenceSourceLang(source: ReferenceSource): DefinitionLang {
  if (source === 'elhuyar_en') return 'en';
  if (source === 'elhuyar_es') return 'es';
  return 'eu';
}
