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

/** T-2.8 / T-2.8a: cheap surface-level detector — does this token
 *  *look* like a numeric token? Accepts:
 *
 *   - unsigned positive integers, optionally with thousands / lakh
 *     comma separators (`"123"`, `"1,000"`, `"10,00,000"`);
 *   - T-2.8a signed integers (`"-12"`, `"−5"` with U+2212);
 *   - T-2.8a decimals (`"3.14"`, `"0.001"`, `"-2.5"`).
 *
 *  Latin (0–9), Devanagari (०–९), and Odia (୦–୯) digit ranges all
 *  qualify; each alternation pins a single script so mixed-script
 *  input (`"1,२३४"`, `"१.5"`) doesn't sneak through. Comma separators
 *  combined with a decimal point (e.g. `"1,000.5"`) are intentionally
 *  out of scope — neither the unsigned-integer nor the signed-decimal
 *  parser accepts that shape, and treating it as numeric here would
 *  desynchronize the UI from the Python parser.
 *
 *  Used both by the dispatcher (skip lemma auto-create for these
 *  surfaces so the lemmas table doesn't fill with "1,013,322"-style
 *  entries) and by the popup / tooltip (treat as a number even when
 *  the older `numberForms` column is null because the chapter was
 *  processed before the comma / sign / decimal support landed). The
 *  full Python parser in `services/nlp/app/numbers.py` is the source
 *  of truth for actually generating the spelled-out forms; this
 *  helper just gates UI branching on the client.
 */
// Two alternatives per script:
//   - integer with optional comma groups (no decimal point)
//   - integer + decimal point + fractional digits (no commas)
// Both wrapped in an optional leading sign (ASCII `-` or U+2212).
const _NUMBER_RE = new RegExp(
  '^[-−]?(?:' +
    '[0-9]+(?:,[0-9]+)*|[0-9]+\\.[0-9]+' +
    '|[०-९]+(?:,[०-९]+)*|[०-९]+\\.[०-९]+' +
    '|[୦-୯]+(?:,[୦-୯]+)*|[୦-୯]+\\.[୦-୯]+' +
  ')$',
  'u',
);
export function looksLikeNumberToken(surface: string): boolean {
  if (!surface) return false;
  // Strip an optional leading sign before the comma-shape checks so
  // `-,1` and `-1,` etc. still get rejected the same way as `,1` /
  // `1,`.
  const body =
    surface.startsWith('-') || surface.startsWith('−')
      ? surface.slice(1)
      : surface;
  if (!body) return false;
  // Reject leading / trailing comma + doubled commas without paying
  // for a regex run.
  if (body.startsWith(',') || body.endsWith(',')) return false;
  if (body.includes(',,')) return false;
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
  /** Canonical Latin-digit string form. T-2.8a widened this from
   *  number to string so signed + decimal numerals (`"-3.14"`,
   *  `"0.001"`) round-trip without floating-point drift. */
  value: string;
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
  /** The viewer's own translation for this lemma, if any. The hover
   *  tooltip prefers this over `glossDefault` so a reader sees their
   *  own words for lemmas they've translated. Null when anonymous
   *  or when the viewer hasn't added a personal translation. */
  personalGloss: string | null;
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

/**
 * One occurrence of a phrase inside a chapter (T-14.3, M14
 * phrase-level translations). The reader wraps the run of tokens
 * from `startTokenIdx` through `endTokenIdx` (inclusive) in a
 * `<phrase>` element so the per-phrase status and gloss can drive
 * highlighting + the popup header.
 *
 * Multiple spans may share `startTokenIdx` (one short, one long) —
 * the renderer picks the longest as the visible wrapper and keeps
 * shorter spans in `data-phrase-overlap` so the popup can offer
 * them as alternatives. Lifecycle parallel to T-14.2's server-side
 * `phrase_chapter_spans` table.
 */
export type ChapterPhraseSpan = {
  phraseId: string;
  startTokenIdx: number;
  endTokenIdx: number;
  glossDefault: string | null;
  status: 'known' | 'learning' | 'ignored' | 'unknown';
};

export type ChapterView = {
  id: string;
  idx: number;
  title: string | null;
  body: string | null;
  tokenCount: number;
  tokens: ServerToken[] | null;
  /** T-14.3: phrase spans for this chapter — empty array when none,
   *  null when the chapter hasn't been processed yet (sibling to
   *  `tokens` null state). */
  phraseSpans: ChapterPhraseSpan[] | null;
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

/**
 * One slot in a paragraph after T-14.3 phrase segmentation. Either
 * a bare token (no phrase covers this idx) or a run of tokens
 * wrapped by the longest phrase that starts at this idx. Shorter
 * overlapping spans are exposed via `overlaps` so the popup can
 * offer them as alternatives without changing the visible wrapper.
 */
export type ParagraphSegment =
  | { kind: 'token'; token: ServerToken }
  | {
      kind: 'phrase';
      span: ChapterPhraseSpan;
      tokens: ServerToken[];
      /** Other spans that start at the same idx but are strictly
       *  shorter than the visible one. Empty when no overlaps. */
      overlaps: ChapterPhraseSpan[];
    };

/**
 * Segment a paragraph into bare-token / phrase-wrapped slots so the
 * renderer can wrap phrase spans in `<phrase>` elements without
 * conditional template logic per token. T-14.2's resolver only
 * emits spans within a single sentence, and paragraphs are
 * supersets of sentences, so a span never crosses a paragraph
 * boundary in practice. The defensive bail-out below handles the
 * theoretical case where a span's `endTokenIdx` lies outside the
 * provided paragraph (a re-process race) by treating those tokens
 * as bare.
 */
export function segmentParagraphPhrases(
  paragraph: ServerToken[],
  spans: ChapterPhraseSpan[],
): ParagraphSegment[] {
  if (spans.length === 0) {
    return paragraph.map((token) => ({ kind: 'token', token }));
  }
  const spansByStart = new Map<number, ChapterPhraseSpan[]>();
  for (const s of spans) {
    let bucket = spansByStart.get(s.startTokenIdx);
    if (!bucket) {
      bucket = [];
      spansByStart.set(s.startTokenIdx, bucket);
    }
    bucket.push(s);
  }

  const out: ParagraphSegment[] = [];
  let i = 0;
  while (i < paragraph.length) {
    const t = paragraph[i]!;
    const candidates = spansByStart.get(t.idx);
    if (candidates && candidates.length > 0) {
      // Longest span wins for the visible wrapper; any shorter
      // siblings sharing the start ride along as overlaps.
      const sorted = [...candidates].sort(
        (a, b) =>
          b.endTokenIdx - b.startTokenIdx - (a.endTokenIdx - a.startTokenIdx),
      );
      const winner = sorted[0]!;
      // Collect tokens up to winner.endTokenIdx (inclusive) that
      // are still in this paragraph.
      const phraseTokens: ServerToken[] = [];
      let j = i;
      while (
        j < paragraph.length &&
        paragraph[j]!.idx <= winner.endTokenIdx
      ) {
        phraseTokens.push(paragraph[j]!);
        j += 1;
      }
      const last = phraseTokens[phraseTokens.length - 1];
      if (last && last.idx === winner.endTokenIdx) {
        out.push({
          kind: 'phrase',
          span: winner,
          tokens: phraseTokens,
          overlaps: sorted.slice(1),
        });
        i = j;
        continue;
      }
      // Span endTokenIdx fell outside this paragraph (defensive
      // path) — fall through to bare-token rendering.
    }
    out.push({ kind: 'token', token: t });
    i += 1;
  }
  return out;
}

/**
 * T-14.3b: a paragraph's segments after pending-selection grouping.
 * Either an untouched segment (`kind: 'plain'`) or a contiguous run
 * of segments that fall inside the user's in-progress shift-click
 * range (`kind: 'pending'`). The renderer wraps the latter in a
 * single `<phrase>`-like element so the highlight (including the
 * whitespace between words) reads as one continuous pill — same
 * shape as the committed `<phrase>` wrapper, so a pending selection
 * visually resolves into a phrase highlight once saved.
 */
export type RenderGroup =
  | { kind: 'plain'; segment: ParagraphSegment }
  | { kind: 'pending'; segments: ParagraphSegment[] };

/**
 * Walk a paragraph's segments and bracket any contiguous run that
 * intersects the pending range under a single `pending` group. A
 * `phrase` segment counts as in-range if any of its tokens fall
 * inside `[start, end]` — partial overlap with an existing phrase
 * still groups the whole phrase, since the phrase wrapper is the
 * smallest renderable unit and we'd otherwise have to break it
 * mid-run. With `range = null` every segment passes through as
 * `plain` (the common case when no shift-click is in flight).
 */
export function groupPendingSegments(
  segments: ParagraphSegment[],
  range: { start: number; end: number } | null,
): RenderGroup[] {
  if (!range) return segments.map((s) => ({ kind: 'plain', segment: s }));
  const { start, end } = range;
  const inRange = (s: ParagraphSegment): boolean => {
    if (s.kind === 'token') return s.token.idx >= start && s.token.idx <= end;
    return s.tokens.some((t) => t.idx >= start && t.idx <= end);
  };
  const out: RenderGroup[] = [];
  let buffer: ParagraphSegment[] = [];
  const flush = () => {
    if (buffer.length === 0) return;
    out.push({ kind: 'pending', segments: buffer });
    buffer = [];
  };
  for (const s of segments) {
    if (inRange(s)) {
      buffer.push(s);
    } else {
      flush();
      out.push({ kind: 'plain', segment: s });
    }
  }
  flush();
  return out;
}
