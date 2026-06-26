/**
 * Pure indexing over the dictionary snapshot. Lemmas are looked up by normalized
 * headword (Basque is lowercase Latin), and several lemmas can share a headword
 * (different parts of speech), so each key maps to a list.
 */
import type { DictionaryExport, ExportedLemma } from '../shared/api-types';

export type HeadwordIndex = Map<string, ExportedLemma[]>;

export function normalizeHeadword(s: string): string {
  return s.normalize('NFC').trim().toLowerCase();
}

export function buildHeadwordIndex(exported: DictionaryExport): HeadwordIndex {
  const index: HeadwordIndex = new Map();
  for (const lemma of exported.lemmas) {
    const key = normalizeHeadword(lemma.headword);
    const list = index.get(key);
    if (list) list.push(lemma);
    else index.set(key, [lemma]);
  }
  return index;
}

export function lookupHeadword(index: HeadwordIndex, word: string): ExportedLemma[] {
  return index.get(normalizeHeadword(word)) ?? [];
}

/** Headwords matching a prefix (then substring), shortest first, for the popup's
 *  form-search autocomplete. Returns the original-cased headwords. */
export function suggestHeadwords(index: HeadwordIndex, prefix: string, limit = 8): string[] {
  const p = normalizeHeadword(prefix);
  if (!p) return [];
  const starts: string[] = [];
  const contains: string[] = [];
  for (const k of index.keys()) {
    if (k.startsWith(p)) starts.push(k);
    else if (k.includes(p)) contains.push(k);
  }
  const byLen = (a: string, b: string): number => a.length - b.length || a.localeCompare(b);
  starts.sort(byLen);
  contains.sort(byLen);
  return [...starts, ...contains]
    .slice(0, limit)
    .map((k) => index.get(k)?.[0]?.headword ?? k);
}
