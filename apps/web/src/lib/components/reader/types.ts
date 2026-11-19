/** One alternate-meaning entry the popup expands when
 *  isAmbiguous=true. The reader pulls these from the
 *  worker's `lemma_candidates` jsonb column and joins them against
 *  `lemmas` so the row already carries headword + POS + gloss for
 *  the popup. */
export type ServerCandidate = {
  bookFrequency?: number;
  selectedBy?: 'ai' | 'human';
  lemmaId: string;
  headword: string;
  pos: string;
  glossDefault: string | null;
  personalGloss?: string | null;
  status?: 'known' | 'learning' | 'ignored' | 'unknown';
  score: number;
  features: Record<string, string>;
};

/**
 * Recognize a numeral from its spelling when an older chapter has no saved number forms. Keep
 * signed values, decimals and grouped digits consistent with the number parser.
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

/** Spelled-out form and ISO 15919 romanization for a
 *  digit-only NUM token. Mirrors `RenderedNumberForms` in
 *  `$lib/server/texts/tokens.ts`. */
export type ServerNumberLanguageForm = {
  spelled: string;
  romanized: string;
};

export type ServerNumberForms = {
  /** Store the digits as text to preserve decimals without rounding. */
  value: string;
  digitsLatin: string;
  digitsDeva: string;
  digitsOrya: string;
  hi: ServerNumberLanguageForm;
  mr: ServerNumberLanguageForm;
  /** Odia rendering. Field is `odia`, not ISO 639-1 `or`, because
   *  `or` is a reserved keyword on the Python side. */
  odia: ServerNumberLanguageForm;
  /** Basque rendering. Latin script, so `romanized` is empty — the
   *  spelled-out (base-20) form is itself the reading. */
  eu: ServerNumberLanguageForm;
};

/** Per-token row from the NLP worker. When present, the
 *  component renders these spans directly; when null, it falls back
 *  to client-side whitespace tokenization. */
export type ServerToken = {
  bookFrequency?: number;
  correctedByViewer?: boolean;
  canVerifyContext?: boolean;
  contextVersion?: string;
  selectedBy?: 'ai' | 'human';
  selectionStatus?: string;
  id: string;
  idx: number;
  /** Owning chapter id (server tokens only). Lets the popup capture the mined
   *  sentence when a word is marked Learning. Absent on client-tokenized
   *  fallback tokens. */
  chapterId?: string;
  surface: string;
  isWord: boolean;
  isAmbiguous: boolean;
  isOov: boolean;
  lemmaId: string | null;
  headword?: string;
  pos?: string;
  romanization: string | null;
  /** Canonical short gloss for the lemma — surfaced in the hover
   *  tooltip. Null when there's no lemma or no gloss yet. */
  glossDefault: string | null;
  /** The viewer's own translation for this lemma, if any. The hover
   *  tooltip prefers this over `glossDefault` so a reader sees their
   *  own words for lemmas they've translated. Null when anonymous
   *  or when the viewer hasn't added a personal translation. */
  personalGloss: string | null;
  /** alternate-meaning candidates for is_ambiguous tokens.
   *  Empty array when the worker scored only one viable candidate
   *  or hasn't run yet. */
  candidates: ServerCandidate[];
  /** Morphology features on the resolved candidate. Drives the
   *  popup's "past · 1sg" pill row. Empty object when the worker
   *  emitted nothing for this token. */
  features: Record<string, string>;
  /** digit-only NUM tokens (e.g. "123" / "१२३" / "୧୨୩")
   *  carry a per-language spelled-out form + ISO-15919 romanization.
   *  Null on every other token. The popup uses this to replace the
   *  lemma/translation block with the three written-out renderings. */
  numberForms: ServerNumberForms | null;
  status: 'known' | 'learning' | 'ignored' | 'unknown';
  /** Whether the reader has a definition to show for this word. */
  hasDefinition?: boolean;
  /** PDF source only: the word's bounding box on the page image,
   *  normalized to 0..1 of the page width/height. Drives the clickable
   *  word hotspots in the image reader. Null/absent for text tokens and
   *  for whitespace/punctuation. */
  bbox?: { x: number; y: number; w: number; h: number } | null;
};

/** Apply a reader correction with the complete dictionary entry for that sense. */
export function withLemmaCorrection(token: ServerToken, lemmaId: string | undefined): ServerToken {
  if (!lemmaId || lemmaId === token.lemmaId) return token;
  const chosen = token.candidates.find((candidate) => candidate.lemmaId === lemmaId);
  if (!chosen) return token;
  const candidates = token.candidates.filter((candidate) => candidate.lemmaId !== lemmaId);
  if (token.lemmaId) {
    candidates.push({
      bookFrequency: token.bookFrequency,
      lemmaId: token.lemmaId, headword: token.headword ?? token.surface, pos: token.pos ?? '',
      glossDefault: token.glossDefault, personalGloss: token.personalGloss, status: token.status,
      score: 0, features: token.features, selectedBy: token.selectedBy,
    });
  }
  return {
    ...token,
    correctedByViewer: true,
    bookFrequency: chosen.bookFrequency,
    lemmaId, headword: chosen.headword, pos: chosen.pos, features: chosen.features,
    glossDefault: chosen.glossDefault, personalGloss: chosen.personalGloss ?? null,
    status: chosen.status ?? 'unknown', selectedBy: chosen.selectedBy,
    hasDefinition: chosen.glossDefault != null, isAmbiguous: candidates.length > 0, candidates,
  };
}

/**
 * Both ends of a phrase are included. When matches start on the same word, the reader shows the
 * longest and keeps the shorter alternatives.
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
  /** Null until the chapter is processed. An empty list means no phrases matched. */
  phraseSpans: ChapterPhraseSpan[] | null;
  /** Page image and optional natural dimensions for the image reader. */
  pageImageUrl?: string | null;
  pageWidth?: number | null;
  pageHeight?: number | null;
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

/** Split the raw chapter text for display while the processed words are unavailable. */
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

/** Blank lines mark paragraph boundaries. Keep the words on each side in separate paragraphs. */
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

/** A paragraph contains ordinary tokens and runs of tokens that belong to a phrase. */
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
 * A phrase fits within one sentence. If a saved match extends past this paragraph, render the
 * words normally so an outdated match cannot hide text.
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
      // Keep shorter matches that begin at the same word.
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
 * a paragraph's segments after pending-selection grouping.
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
