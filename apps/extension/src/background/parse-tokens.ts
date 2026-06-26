/**
 * Pure extraction of dictionary-form lemmas from a parse response.
 *
 * When we parse a single clicked surface word, we want the lemma candidates for
 * the first lexical token (the NLP service may emit several candidates when a
 * form is ambiguous). Punctuation/whitespace tokens (`is_word === false`) are
 * skipped.
 */
import type { ParseResponse } from '../shared/api-types';

export function pickLemmas(parse: ParseResponse): string[] {
  const token = parse.tokens.find((t) => t.is_word);
  if (!token) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of token.candidates) {
    const lemma = candidate.lemma.trim();
    if (lemma && !seen.has(lemma)) {
      seen.add(lemma);
      out.push(lemma);
    }
  }
  return out;
}
