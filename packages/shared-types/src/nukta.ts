/**
 * Nukta-stripping helper (#318).
 *
 * The Devanagari nukta (U+093C COMBINING DEVANAGARI SIGN NUKTA) marks
 * a small set of consonants borrowed from Persian/Arabic vocabulary —
 * `ज़` (z) vs `ज` (j), `फ़` (f) vs `फ` (ph), `ड़` / `ढ़` for the retroflex
 * flap consonants in native verbs (`पढ़ना` "to read", `बढ़ना` "to grow"),
 * and a handful of less-common Persianate consonants `क़` / `ख़` / `ग़` /
 * `य़` / `ऩ`. In published text the nukta is usually written; in casual
 * typing — and across many user-generated dictionary sources — it gets
 * dropped with no fixed convention. `पढ़ना` and `पढना` are observed in
 * the wild for the same word.
 *
 * `stripNukta` removes that distinction so a search/lookup can fall
 * back to a nukta-agnostic match when an exact match misses. **It is a
 * lossy normalization**: `ज़रा` "a little" and `जरा` "old age" are
 * genuinely different words that strip to the same key. Callers MUST
 * try the exact form first and only consult the stripped form when the
 * exact tier returns no hits — and ideally surface a "showing
 * nukta-agnostic results" hint to the user so the lossy step is
 * visible.
 *
 * Behavior:
 *  - NFC-normalize first so the two equivalent encodings of every
 *    nukta consonant (atomic precomposed codepoint vs. base + U+093C)
 *    funnel through the same path.
 *  - Map every atomic precomposed nukta consonant (`U+0958` क़ ..
 *    `U+095F` य़, plus `U+0929` ऩ) to its non-nukta base.
 *  - Remove every standalone U+093C left over after that step
 *    (covers the decomposed encoding and any unusual NFC behavior).
 *
 * The result is itself NFC and contains no U+093C nor any of the
 * atomic nukta codepoints, which is the property the
 * `headword_nukta_stripped` Postgres generated column relies on for a
 * direct equality check between the JS-side `stripNukta(query)` and
 * the DB-side stored value.
 */

const NUKTA = '़';

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
  return out;
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
    if (ch in ATOMIC_TO_BASE) return true;
  }
  return false;
}
