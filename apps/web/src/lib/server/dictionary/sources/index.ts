/**
 * Registry of available dictionary import sources (T-3.10).
 *
 * Each entry here is what `pnpm dictionary:import [name]` can run. Adding
 * a new importer is a one-line append plus the source module — the
 * runner script reads this list, never the individual files, so a new
 * source automatically appears in `--list` output and CI smoke runs.
 *
 * The shape is `{ name, source }` (rather than just `source`) because
 * we want the script's `--list` output and CLI selector to use a stable
 * short name without instantiating each `DictionaryImportSource`
 * (importing them eagerly is fine today; the indirection lets us add
 * lazy-loaded sources later without rewriting callers).
 */
import type { DictionaryImportSource } from '../types.js';

import { hindiSeedSource } from './hindi-seed.js';
import { kaikkiBasqueEsSource } from './kaikki-basque-es.js';
import { kaikkiBasqueSource } from './kaikki-basque.js';
import { kaikkiEnTranslationsBasqueSource } from './kaikki-en-translations-basque.js';
import { kaikkiEnTranslationsHindiSource } from './kaikki-en-translations-hindi.js';
import { kaikkiEnTranslationsMarathiSource } from './kaikki-en-translations-marathi.js';
import { kaikkiEnTranslationsOdiaSource } from './kaikki-en-translations-odia.js';
import { kaikkiEnTranslationsYiddishSource } from './kaikki-en-translations-yiddish.js';
import { kaikkiHindiSource } from './kaikki-hindi.js';
import { kaikkiMarathiSource } from './kaikki-marathi.js';
import { kaikkiOdiaSource } from './kaikki-odia.js';
import { kaikkiYiddishSource } from './kaikki-yiddish.js';

export type RegistryEntry = {
  name: string;
  source: DictionaryImportSource;
};

export const dictionarySources: RegistryEntry[] = [
  { name: hindiSeedSource.name, source: hindiSeedSource },
  { name: kaikkiHindiSource.name, source: kaikkiHindiSource },
  { name: kaikkiMarathiSource.name, source: kaikkiMarathiSource },
  { name: kaikkiOdiaSource.name, source: kaikkiOdiaSource },
  { name: kaikkiYiddishSource.name, source: kaikkiYiddishSource },
  { name: kaikkiBasqueSource.name, source: kaikkiBasqueSource },
  { name: kaikkiBasqueEsSource.name, source: kaikkiBasqueEsSource },
  {
    name: kaikkiEnTranslationsHindiSource.name,
    source: kaikkiEnTranslationsHindiSource,
  },
  {
    name: kaikkiEnTranslationsMarathiSource.name,
    source: kaikkiEnTranslationsMarathiSource,
  },
  {
    name: kaikkiEnTranslationsOdiaSource.name,
    source: kaikkiEnTranslationsOdiaSource,
  },
  {
    name: kaikkiEnTranslationsYiddishSource.name,
    source: kaikkiEnTranslationsYiddishSource,
  },
  {
    name: kaikkiEnTranslationsBasqueSource.name,
    source: kaikkiEnTranslationsBasqueSource,
  },
];

export function findSource(name: string): DictionaryImportSource | undefined {
  return dictionarySources.find((e) => e.name === name)?.source;
}
