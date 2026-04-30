/**
 * Shared types for the reader components (T-5.1).
 *
 * The three layout modes (`page`, `paged_scroll`, `continuous`) all
 * accept the same `ChapterView` data so token rendering + the
 * pop-up + known-words affordances can be added once and used by
 * every mode (T-5.2 onward).
 */

/** One alternate-meaning entry the popup expands when
 *  isAmbiguous=true (T-6.1). The reader pulls these from the
 *  worker's `lemma_candidates` jsonb column and joins them against
 *  `lemmas` so the row already carries headword + POS + gloss for
 *  the popup. */
export type ServerCandidate = {
  lemmaId: string;
  headword: string;
  pos: string;
  glossDefault: string | null;
  score: number;
  features: Record<string, string>;
};

/** T-2.8: cheap surface-level detector — does this token *look* like a
 *  digit-only number, possibly with thousands / lakh separators?
 *  Latin (0–9), Devanagari (०–९), and Odia (୦–୯) digit ranges all
 *  qualify. Mixed-script doesn't. Used both by the dispatcher (skip
 *  lemma auto-create for these surfaces so the lemmas table doesn't
 *  fill with "1,013,322"-style entries) and by the popup / tooltip
 *  (treat as a number even when the older `numberForms` column is
 *  null because the chapter was processed before the comma fix
 *  landed). The full Python parser in `services/nlp/app/numbers.py`
 *  is the source of truth for actually generating the spelled-out
 *  forms; this helper just gates UI branching on the client. */
// Each alternation pins a single script across all comma-separated
// groups so mixed-script input ("1,२३४") doesn't sneak through.
const _NUMBER_RE =
  /^(?:[0-9]+(?:,[0-9]+)*|[०-९]+(?:,[०-९]+)*|[୦-୯]+(?:,[୦-୯]+)*)$/u;
export function looksLikeNumberToken(surface: string): boolean {
  if (!surface) return false;
  // Reject leading / trailing comma without paying for a regex run.
  if (surface.startsWith(',') || surface.endsWith(',')) return false;
  if (surface.includes(',,')) return false;
  return _NUMBER_RE.test(surface);
}

/** T-2.8: per-language spelled-out + ISO 15919 romanization for a
 *  digit-only NUM token. Mirrors `RenderedNumberForms` in
 *  `$lib/server/texts/tokens.ts`. */
export type ServerNumberLanguageForm = {
  spelled: string;
  romanized: string;
};

export type ServerNumberForms = {
  value: number;
  digitsLatin: string;
  digitsDeva: string;
  digitsOrya: string;
  hi: ServerNumberLanguageForm;
  mr: ServerNumberLanguageForm;
  /** Odia rendering. Field is `odia`, not ISO 639-1 `or`, because
   *  `or` is a reserved keyword on the Python side. */
  odia: ServerNumberLanguageForm;
};

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
  /** Canonical short gloss for the lemma — surfaced in the hover
   *  tooltip (T-5.18). Null when there's no lemma or no gloss yet. */
  glossDefault: string | null;
  /** T-6.1: alternate-meaning candidates for is_ambiguous tokens.
   *  Empty array when the worker scored only one viable candidate
   *  or hasn't run yet. */
  candidates: ServerCandidate[];
  /** T-2.8: digit-only NUM tokens (e.g. "123" / "१२३" / "୧୨୩")
   *  carry a per-language spelled-out form + ISO-15919 romanization.
   *  Null on every other token. The popup uses this to replace the
   *  lemma/translation block with the three written-out renderings. */
  numberForms: ServerNumberForms | null;
  status: 'known' | 'learning' | 'ignored' | 'unknown';
};

export type ChapterView = {
  id: string;
  idx: number;
  title: string | null;
  body: string | null;
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
