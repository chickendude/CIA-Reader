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
