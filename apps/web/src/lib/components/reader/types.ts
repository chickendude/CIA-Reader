/**
 * Shared types for the reader components (T-5.1).
 *
 * The three layout modes (`page`, `paged_scroll`, `continuous`) all
 * accept the same `ChapterView` data so token rendering + the
 * pop-up + known-words affordances can be added once and used by
 * every mode (T-5.2 onward).
 */

/** Per-token row from the NLP worker (T-5.2). When present, the
 *  component renders these spans directly; when null, it falls back
 *  to client-side whitespace tokenization. */
export type ServerToken = {
  id: string;
  idx: number;
  surface: string;
  isWord: boolean;
  isAmbiguous: boolean;
  isOov: boolean;
  lemmaId: string | null;
  romanization: string | null;
  status: 'known' | 'learning' | 'ignored' | 'unknown';
};

export type ChapterView = {
  id: string;
  idx: number;
  title: string | null;
  body: string;
  tokenCount: number;
  tokens: ServerToken[] | null;
};

export type ReaderLayoutMode = 'page' | 'paged_scroll' | 'continuous';

/**
 * Numeric status code emitted as `data-s` on each rendered word so the
 * design's highlight CSS (background-tint vs. underline modes, see
 * `tokens.css`) can target the right tint without the markup needing to
 * know about saffron OKLCH math. The numbers are stable: `0=new` for an
 * unknown lemma the user hasn't categorized, `2=L2` is where we map our
 * single "learning" bucket today, `4=known`, `5=ignored`. `1` and `3`
 * are reserved for L1 / L3 once we split the learning bucket.
 */
export type StatusCode = '0' | '1' | '2' | '3' | '4' | '5';
export const STATUS_TO_CODE: Readonly<Record<ServerToken['status'], StatusCode>> =
  {
    unknown: '0',
    learning: '2',
    known: '4',
    ignored: '5',
  } as const;

export function statusToCode(status: ServerToken['status']): StatusCode {
  return STATUS_TO_CODE[status];
}

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

/** Server-token analogue of `paragraphsOfTokens`. The worker writes
 * the surface form including paragraph-boundary whitespace as its
 * own non-word token; we cut on those. */
export function paragraphsOfServerTokens(
  tokens: ServerToken[],
): ServerToken[][] {
  const out: ServerToken[][] = [];
  let current: ServerToken[] = [];
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
