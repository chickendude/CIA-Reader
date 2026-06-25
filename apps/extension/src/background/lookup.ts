/**
 * Look up a clicked/hovered surface word: resolve it to its dictionary form
 * (cached parse) and gather offline internal-dictionary entries for the lemma(s),
 * collapsing duplicate rows. External reference dictionaries (Elhuyar /
 * Euskaltzaindia) are fetched separately (see reference.ts).
 */
import type { ExportedLemma } from '../shared/api-types';
import type { LookupResult } from '../shared/lookup';
import { localDictionary } from './dictionary-local';
import { parseCache } from './parse-cache';

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

  // The dictionary often holds several rows for the same headword+POS (from
  // multiple import sources); collapse them into one entry and merge their
  // translations so the popup shows a single clean entry per sense.
  const byKey = new Map<string, ExportedLemma>();
  for (const key of keys) {
    for (const entry of await deps.dictLookup(language, key)) {
      const k = `${entry.headword.toLocaleLowerCase()}|${entry.pos}`;
      const existing = byKey.get(k);
      if (!existing) {
        byKey.set(k, { ...entry, translations: dedupeByBody(entry.translations) });
      } else {
        const bodies = new Set(existing.translations.map((t) => t.body));
        for (const t of entry.translations) {
          if (!bodies.has(t.body)) {
            existing.translations.push(t);
            bodies.add(t.body);
          }
        }
        if (!existing.gloss && entry.gloss) existing.gloss = entry.gloss;
      }
    }
  }

  // Entries with an actual definition first.
  const score = (e: ExportedLemma) => e.translations.length + (e.gloss ? 1 : 0);
  const entries = [...byKey.values()].sort((a, b) => score(b) - score(a));

  return { surface, lemmas, entries };
}

function dedupeByBody(translations: ExportedLemma['translations']): ExportedLemma['translations'] {
  const seen = new Set<string>();
  return translations.filter((t) => (seen.has(t.body) ? false : (seen.add(t.body), true)));
}
