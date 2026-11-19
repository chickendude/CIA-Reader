/**
 * Try exact spellings first. Removing a Devanagari nukta can make different words look alike,
 * such as ज़रा (a little) and जरा (old age). For Yiddish, equivalent ways to type a ligature
 * should share a search key. Keep these rules in sync with the database column
 * headword_nukta_stripped.
 */

const NUKTA = '़';

// U+05B7 HEBREW POINT PATAH (pasekh in Yiddish terminology).
const PASEKH = 'ַ';

// Atomic precomposed nukta consonants → non-nukta base.
// Order is the Unicode codepoint order; this map is exhaustive for
// Devanagari nukta letters as of Unicode 16.
const ATOMIC_TO_BASE: Readonly<Record<string, string>> = Object.freeze({
  'ऩ': 'न', // ऩ → न
  'क़': 'क', // क़ → क
  'ख़': 'ख', // ख़ → ख
  'ग़': 'ग', // ग़ → ग
  'ज़': 'ज', // ज़ → ज
  'ड़': 'ड', // ड़ → ड
  'ढ़': 'ढ', // ढ़ → ढ
  'फ़': 'फ', // फ़ → फ
  'य़': 'य', // य़ → य
  // Hebrew ligature digraphs → letter pairs (Yiddish). Not lossy —
  // pure presentation variants of the same letters.
  'װ': 'וו', // tsvey vovn ligature → vov vov
  'ױ': 'וי', // vov-yud ligature → vov yud
  'ײ': 'יי', // tsvey yudn ligature → yud yud
});

/**
 * Return `input` with every nukta-marking removed. See module
 * docstring for the rationale and the (intentional) lossiness.
 *
 * Empty / null-ish input passes through as the empty string so
 * callers can use this on optional query fragments without
 * special-casing.
 */
export function stripNukta(input: string): string {
  if (!input) return '';
  // NFC first so an atomic ज़ stays atomic and a decomposed ज + U+093C
  // collapses to its canonical form before we consider it. Postgres
  // composition exclusions mean NFC actually keeps decomposed ज+U+093C
  // as decomposed (it does NOT recompose to U+095B); that's fine —
  // the per-character pass below handles both cases.
  const normalized = input.normalize('NFC');
  let out = '';
  for (const ch of normalized) {
    if (ch === NUKTA) continue;
    const base = ATOMIC_TO_BASE[ch];
    out += base ?? ch;
  }
  // Pasekh tsvey yudn: fold the pasekh-on-first-yud encoding onto the
  // canonical pasekh-on-second-yud form. Runs after the ligature map
  // so ײ + pasekh has already become יי + pasekh. replaceAll, not
  // replace — Postgres's replace() substitutes every occurrence and
  // the two sides must stay equal.
  return out.replaceAll('י' + PASEKH + 'י', 'יי' + PASEKH);
}

/**
 * True when stripping a nukta from `input` would actually change it —
 * i.e. the input contains at least one nukta marker, atomic or
 * decomposed. UI surfaces use this to decide whether to show a
 * "nukta-agnostic" hint at all (when the user already typed a
 * nukta-free query, the fallback isn't lossy and there's nothing to
 * surface).
 */
export function hasNukta(input: string): boolean {
  if (!input) return false;
  const normalized = input.normalize('NFC');
  for (const ch of normalized) {
    if (ch === NUKTA) return true;
    // Deliberately Devanagari-only: the Hebrew ligature entries in
    // ATOMIC_TO_BASE are non-lossy folds and should not trigger the
    // "nukta-agnostic results" hint.
    if (ch in ATOMIC_TO_BASE && ch >= '\u0900' && ch <= '\u097F') return true;
  }
  return false;
}
