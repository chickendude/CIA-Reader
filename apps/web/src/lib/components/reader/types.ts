/**
 * Shared types for the reader components (T-5.1).
 *
 * The three layout modes (`page`, `paged_scroll`, `continuous`) all
 * accept the same `ChapterView` data so token rendering + the
 * pop-up + known-words affordances can be added once and used by
 * every mode (T-5.2 onward).
 */

export type ChapterView = {
  id: string;
  idx: number;
  title: string | null;
  body: string;
  tokenCount: number;
};

export type ReaderLayoutMode = 'page' | 'paged_scroll' | 'continuous';

/**
 * Cheap whitespace tokenizer for the placeholder render path. M5's
 * later tickets replace this with token rows from the NLP worker
 * (T-2.6) — at that point the reader pulls token spans straight from
 * Postgres and this helper goes away.
 */
export type RenderToken = {
  /** Position within the chapter, 0-based. */
  idx: number;
  /** Surface form as it appears in the chapter. */
  surface: string;
  /** True if the token is a word (contains at least one letter or
   * Indic codepoint), false for punctuation / whitespace. The reader
   * will only attach the pop-up to word tokens. */
  isWord: boolean;
};

// `\p{L}` letters + `\p{N}` digits + `\p{M}` combining marks. The
// last is critical for Indic scripts: Devanagari `बोलना` and Odia
// `ଓଡ଼ିଆ` rely on Mn-category vowel-sign codepoints attached to a
// base letter, and a tokenizer that treats `\p{M}` as non-word would
// shred every word into single-codepoint fragments.
const WORD_RE = /[\p{L}\p{N}\p{M}_]/u;

/**
 * Split a chapter body into ordered render tokens. Preserves
 * whitespace + punctuation as their own non-word tokens so the
 * reader can render the original layout faithfully.
 */
export function tokenize(body: string): RenderToken[] {
  const tokens: RenderToken[] = [];
  const re = /[\p{L}\p{N}\p{M}_]+|\s+|[^\p{L}\p{N}\p{M}\s_]+/gu;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(body))) {
    const surface = m[0];
    tokens.push({
      idx: i,
      surface,
      isWord: WORD_RE.test(surface[0]!),
    });
    i += 1;
  }
  return tokens;
}

/**
 * Group tokens by paragraph (the pre-tokenization step splits on
 * blank lines, the post-tokenization helper just walks tokens and
 * cuts on `\n\n+` whitespace tokens). M5 keeps paragraph integrity
 * because translating in-context matters.
 */
export function paragraphsOfTokens(tokens: RenderToken[]): RenderToken[][] {
  const out: RenderToken[][] = [];
  let current: RenderToken[] = [];
  for (const t of tokens) {
    if (!t.isWord && /\n\s*\n/.test(t.surface)) {
      if (current.length > 0) out.push(current);
      current = [];
      continue;
    }
    current.push(t);
  }
  if (current.length > 0) out.push(current);
  return out;
}
