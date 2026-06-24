/**
 * Result of looking up a clicked word: the resolved dictionary-form lemma(s),
 * matching internal-dictionary entries (offline), external reference-dictionary
 * entries (Elhuyar / Euskaltzaindia — populated once the scrapers land), and
 * external-link fallbacks (Wiktionary / Glosbe).
 */
import type { ExportedLemma } from './api-types';

export type ReferenceEntry = {
  source: string;
  label: string;
  headword: string;
  pos: string;
  definition: string;
  examples: string[];
  url: string;
};

export type ExternalLink = { label: string; url: string };

export type LookupResult = {
  surface: string;
  lemmas: string[];
  entries: ExportedLemma[];
  reference: ReferenceEntry[];
  links: ExternalLink[];
};
