/**
 * Look up a clicked surface word: resolve it to its dictionary form (cached
 * parse), gather offline internal-dictionary entries for the lemma(s), and add
 * external-dictionary links. Elhuyar/Euskaltzaindia inline content is added by
 * the reference scrapers (next step); for now they're links alongside
 * Wiktionary/Glosbe.
 */
import type { ExportedLemma } from '../shared/api-types';
import type { ExternalLink, LookupResult } from '../shared/lookup';
import { localDictionary } from './dictionary-local';
import { parseCache } from './parse-cache';

export function externalLinks(word: string): ExternalLink[] {
  const w = encodeURIComponent(word.toLocaleLowerCase());
  return [
    { label: 'Elhuyar', url: `https://hiztegiak.elhuyar.eus/eu/${w}` },
    {
      label: 'Euskaltzaindia',
      url: `https://www.euskaltzaindia.eus/index.php?option=com_hiztegianbilatu&task=bilaketa&query=${w}`,
    },
    { label: 'Wiktionary', url: `https://en.wiktionary.org/wiki/${w}#Basque` },
    { label: 'Glosbe', url: `https://glosbe.com/eu/en/${w}` },
  ];
}

type LookupDeps = {
  resolveLemmas(language: string, surface: string): Promise<string[]>;
  dictLookup(language: string, word: string): Promise<ExportedLemma[]>;
};

const defaultDeps: LookupDeps = {
  resolveLemmas: (l, s) => parseCache.resolveLemmas(l, s),
  dictLookup: (l, w) => localDictionary.lookup(l, w),
};

export async function lookupWord(
  language: string,
  surface: string,
  deps: LookupDeps = defaultDeps,
): Promise<LookupResult> {
  const lemmas = await deps.resolveLemmas(language, surface);
  // Look up each resolved lemma; fall back to the raw surface if parsing found
  // nothing (e.g. an OOV proper noun).
  const keys = lemmas.length > 0 ? lemmas : [surface];

  const entries: ExportedLemma[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    for (const entry of await deps.dictLookup(language, key)) {
      if (!seen.has(entry.id)) {
        seen.add(entry.id);
        entries.push(entry);
      }
    }
  }

  const head = lemmas[0] ?? surface;
  return { surface, lemmas, entries, reference: [], links: externalLinks(head) };
}
