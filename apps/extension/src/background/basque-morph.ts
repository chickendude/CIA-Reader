/**
 * Heuristic Basque lemma-candidate generation.
 *
 * Stanza emits a single best lemma per token, so an ambiguous declined form
 * like "baratzera" (allative of the noun "baratze") only ever yields Stanza's
 * pick ("baratu", the verb). Basque case/number marking is regular and
 * suffixing, so we recover the missed stems by stripping known case endings and
 * — crucially — keeping only the stems that are *real dictionary headwords*.
 * Dictionary validation (done by the caller) means a wrong strip can't surface a
 * non-word; at worst it offers an extra real headword the user ignores.
 *
 * This is deliberately a recall aid layered on top of Stanza, not a morphological
 * analyzer: it doesn't model epenthesis or stem mutations beyond the common
 * "stem ends in a vowel that the suffix absorbs" cases the endings below cover.
 */

// Surface case/number endings, longest first. Mix of singular, plural and
// indefinite declension plus the common local cases. Longer, more specific
// endings are listed first so they're tried before their shorter substrings.
const BASQUE_SUFFIXES: readonly string[] = [
  'engandik',
  'engana',
  'arengan',
  'etatik',
  'etarako',
  'etara',
  'etako',
  'etan',
  'etaz',
  'arekin',
  'rentzat',
  'entzat',
  'engatik',
  'gatik',
  'aren',
  'rako',
  'rekin',
  'ekin',
  'tako',
  'tara',
  'tatik',
  'ari',
  'ean',
  'era',
  'ra',
  'an',
  'tik',
  'eko',
  'ko',
  'rik',
  'az',
  'ez',
  'ak',
  'ek',
  'en',
  'ik',
  'a',
  'k',
  'e',
];

/**
 * Candidate stems for a Basque surface form, by stripping each known case
 * ending. Returns de-duplicated lowercased stems (excluding the surface
 * itself); the caller is expected to keep only those present in the dictionary.
 */
export function basqueStemCandidates(surface: string): string[] {
  const w = surface.toLocaleLowerCase().trim();
  if (!/^[a-zñü·'-]+$/i.test(w)) return [];
  const out = new Set<string>();
  for (const suf of BASQUE_SUFFIXES) {
    // Keep a stem of at least 2 letters so we don't strip a word down to noise.
    if (w.endsWith(suf) && w.length - suf.length >= 2) {
      out.add(w.slice(0, w.length - suf.length));
    }
  }
  out.delete(w);
  return [...out];
}
