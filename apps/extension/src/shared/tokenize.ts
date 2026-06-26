/**
 * Split a subtitle line into clickable word runs and the separators between
 * them, so we can make each word individually interactive while keeping
 * punctuation/spacing intact. A "word" is a run of Unicode letters (plus
 * combining marks, apostrophes, and hyphens — enough for Basque).
 */
export type CuePart = { word: boolean; text: string };

const WORD_RE = /\p{L}[\p{L}\p{M}'’-]*/gu;

export function splitCueWords(text: string): CuePart[] {
  const parts: CuePart[] = [];
  let last = 0;
  for (const m of text.matchAll(WORD_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push({ word: false, text: text.slice(last, idx) });
    parts.push({ word: true, text: m[0] });
    last = idx + m[0].length;
  }
  if (last < text.length) parts.push({ word: false, text: text.slice(last) });
  return parts;
}
