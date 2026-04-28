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
import { kaikkiHindiSource } from './kaikki-hindi.js';
import { kaikkiMarathiSource } from './kaikki-marathi.js';

export type RegistryEntry = {
  name: string;
  source: DictionaryImportSource;
};

export const dictionarySources: RegistryEntry[] = [
  { name: hindiSeedSource.name, source: hindiSeedSource },
  { name: kaikkiHindiSource.name, source: kaikkiHindiSource },
  { name: kaikkiMarathiSource.name, source: kaikkiMarathiSource },
];

export function findSource(name: string): DictionaryImportSource | undefined {
  return dictionarySources.find((e) => e.name === name)?.source;
}
