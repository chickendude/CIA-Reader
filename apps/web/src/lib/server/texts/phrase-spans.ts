/**
 * Chapter phrase span resolver (T-14.2).
 *
 * Builds `phrase_chapter_spans` for one chapter — every contiguous,
 * surface-exact occurrence of any `phrases` row whose language
 * matches the chapter's language. The resolver runs after the NLP
 * worker writes `text_tokens` (see `in-process-dispatcher.ts`) and
 * on every text reprocess. The result is read by `loadChapterTokens`
 * (T-5.2) and surfaced to the reader UI in T-14.3.
 *
 * Algorithm
 * ---------
 *
 * 1. Load every `phrase_tokens` row for the chapter's language,
 *    bucketed by first-token surface. A phrase with N tokens
 *    contributes one bucket entry plus the rest of its surfaces.
 * 2. Walk `text_tokens` in `idx` order. At each position `i` look
 *    up first-surface buckets matching `tokens[i].surface`. For
 *    each candidate phrase, try to extend by checking that the
 *    next `length-1` token surfaces match in order.
 * 3. Refuse to emit a span that crosses a `sentence_idx` boundary.
 *    The constraint lives here, not in the phrase table — phrases
 *    are sentence-agnostic dictionary entries; "is this a valid
 *    chapter occurrence" is the resolver's job.
 * 4. Replace any prior spans for the chapter with the freshly
 *    computed set in a single transaction-shaped DELETE+INSERT.
 *
 * Multi-occurrence and overlap
 * ----------------------------
 *
 * The PK on `phrase_chapter_spans` is `(chapter_id, start_token_idx,
 * phrase_id)` — multiple phrases can start at the same position
 * (longest-wins is a render-time decision, T-14.3) and a single
 * phrase can occur multiple times in the chapter at different start
 * positions. The resolver emits everything; downstream layers
 * filter.
 *
 * MVP scope
 * ---------
 *
 * Contiguous, surface-exact matching only. Discontinuous (gappy)
 * matches like `इंतज़ार ... किया` split by an intervening adverb are
 * an explicit follow-up — when that ships the change will live
 * entirely in this resolver, no schema migration. Per-user filters
 * (e.g. honouring `mark_not_a_word` corrections from T-6.4) are
 * not applied here either; spans are per-chapter and shared. T-14.3
 * may layer per-user filtering at render time.
 */
import { eq, inArray } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import type {
  PhraseChapterSpan,
  PhraseToken,
  TextToken,
} from '../db/schema.js';
import type { LanguageCode } from '@ciareader/shared-types';

// -----------------------------------------------------------------------
// Inputs / outputs.
// -----------------------------------------------------------------------

export type ResolvedPhraseSpan = {
  chapterId: string;
  phraseId: string;
  startTokenIdx: number;
  endTokenIdx: number;
};

/**
 * Slim shape of a `text_tokens` row consumed by the resolver. Kept
 * separate from the full `TextToken` so the algorithm is easy to
 * unit-test by passing literal arrays without faking every column.
 */
export type ResolverToken = Pick<
  TextToken,
  'idx' | 'surface' | 'isWord' | 'sentenceIdx'
>;

export type PhraseLookupEntry = {
  phraseId: string;
  /** Ordered surfaces (position 0..n-1). */
  surfaces: string[];
};

// -----------------------------------------------------------------------
// Pure matcher.
// -----------------------------------------------------------------------

/**
 * Compute spans for one chapter given its tokens (in idx order) and
 * the language's phrase list. Pure — no DB calls — so test cases
 * can pass synthetic inputs and assert the boundary / multi-
 * occurrence semantics without staging Drizzle mocks.
 */
export function resolveSpans(
  chapterId: string,
  tokens: ResolverToken[],
  phrases: PhraseLookupEntry[],
): ResolvedPhraseSpan[] {
  // Index phrase_tokens by first-surface so the per-token lookup
  // is O(1). A 50k-phrase language costs ~a few MB at MVP scale.
  const byFirstSurface = new Map<string, PhraseLookupEntry[]>();
  for (const p of phrases) {
    if (p.surfaces.length === 0) continue;
    const head = p.surfaces[0]!;
    let bucket = byFirstSurface.get(head);
    if (!bucket) {
      bucket = [];
      byFirstSurface.set(head, bucket);
    }
    bucket.push(p);
  }

  // For fast lookup of token by `idx`. text_tokens are dense
  // (every position from 0..n-1 present) but defensive against
  // gaps from re-imports — index by idx rather than position in
  // array.
  const ordered = [...tokens].sort((a, b) => a.idx - b.idx);

  const spans: ResolvedPhraseSpan[] = [];

  for (let i = 0; i < ordered.length; i++) {
    const head = ordered[i];
    if (!head) continue;
    if (!head.isWord) continue;
    const bucket = byFirstSurface.get(head.surface);
    if (!bucket) continue;

    for (const p of bucket) {
      const len = p.surfaces.length;
      if (i + len > ordered.length) continue; // not enough tokens left

      let ok = true;
      for (let k = 1; k < len; k++) {
        const t = ordered[i + k]!;
        // T-14.2: same-sentence constraint. Spans cannot cross a
        // sentence break — `sentence_idx` is set by the worker
        // (currently always 0 in the in-process dispatcher; once
        // sentence segmentation lands, this guard activates
        // automatically). The phrase table itself is sentence-
        // agnostic.
        if (t.sentenceIdx !== head.sentenceIdx) {
          ok = false;
          break;
        }
        // Refuse to span a non-word token (punctuation breaking the
        // run). Even when sentence_idx isn't populated, this keeps
        // a stray punctuation mark from anchoring a phrase match.
        if (!t.isWord) {
          ok = false;
          break;
        }
        if (t.surface !== p.surfaces[k]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      const endIdx = ordered[i + len - 1]!.idx;
      spans.push({
        chapterId,
        phraseId: p.phraseId,
        startTokenIdx: head.idx,
        endTokenIdx: endIdx,
      });
    }
  }

  return spans;
}

// -----------------------------------------------------------------------
// DB-bound rebuild.
// -----------------------------------------------------------------------

/**
 * Rebuild `phrase_chapter_spans` for one chapter. Called by the
 * worker after `text_tokens` is written (and by the T-6.8 admin
 * reprocess action via the same path).
 *
 * Returns the number of spans written so callers can log progress.
 */
export async function rebuildChapterSpans(args: {
  chapterId: string;
  language: LanguageCode;
}): Promise<number> {
  const tokens = (await db
    .select({
      idx: schema.textTokens.idx,
      surface: schema.textTokens.surface,
      isWord: schema.textTokens.isWord,
      sentenceIdx: schema.textTokens.sentenceIdx,
    })
    .from(schema.textTokens)
    .where(eq(schema.textTokens.chapterId, args.chapterId))) as ResolverToken[];

  if (tokens.length === 0) {
    // No text yet — make sure no stale spans hang around (e.g. the
    // chapter's tokens were truncated to zero on a re-process).
    await db
      .delete(schema.phraseChapterSpans)
      .where(eq(schema.phraseChapterSpans.chapterId, args.chapterId));
    return 0;
  }

  const phrases = await loadLanguagePhrases(args.language);
  if (phrases.length === 0) {
    await db
      .delete(schema.phraseChapterSpans)
      .where(eq(schema.phraseChapterSpans.chapterId, args.chapterId));
    return 0;
  }

  const spans = resolveSpans(args.chapterId, tokens, phrases);

  // DELETE + INSERT keeps the resolver idempotent. A failed run
  // mid-chapter leaves the chapter spanless on retry — preferable
  // to half-applied state.
  await db
    .delete(schema.phraseChapterSpans)
    .where(eq(schema.phraseChapterSpans.chapterId, args.chapterId));
  if (spans.length === 0) return 0;

  // Postgres caps a single INSERT at 65534 bound parameters; with
  // 4 columns per row that's ~16k rows max. Phrase span density is
  // far lower than text_tokens, but batch defensively to match the
  // dispatcher's text_tokens batching.
  const BATCH = 1000;
  for (let off = 0; off < spans.length; off += BATCH) {
    await db.insert(schema.phraseChapterSpans).values(spans.slice(off, off + BATCH));
  }
  return spans.length;
}

/**
 * Load all `phrase_tokens` rows for the language's phrases, joined
 * back into ordered surface arrays. One round trip; subsequent
 * resolver calls within the same process can cache via the lemma
 * index pattern in the dispatcher if hot loops appear.
 */
async function loadLanguagePhrases(
  language: LanguageCode,
): Promise<PhraseLookupEntry[]> {
  const phraseRows = (await db
    .select({ id: schema.phrases.id })
    .from(schema.phrases)
    .where(eq(schema.phrases.language, language))) as Array<{ id: string }>;
  if (phraseRows.length === 0) return [];

  const phraseIds = phraseRows.map((r) => r.id);
  const tokenRows = (await db
    .select({
      phraseId: schema.phraseTokens.phraseId,
      position: schema.phraseTokens.position,
      surface: schema.phraseTokens.surface,
    })
    .from(schema.phraseTokens)
    .where(inArray(schema.phraseTokens.phraseId, phraseIds))) as Array<
    Pick<PhraseToken, 'phraseId' | 'position' | 'surface'>
  >;

  const byPhrase = new Map<string, Array<{ position: number; surface: string }>>();
  for (const r of tokenRows) {
    let list = byPhrase.get(r.phraseId);
    if (!list) {
      list = [];
      byPhrase.set(r.phraseId, list);
    }
    list.push({ position: r.position, surface: r.surface });
  }
  const out: PhraseLookupEntry[] = [];
  for (const [phraseId, rows] of byPhrase.entries()) {
    rows.sort((a, b) => a.position - b.position);
    out.push({
      phraseId,
      surfaces: rows.map((r) => r.surface),
    });
  }
  return out;
}

/**
 * Public projection consumed by the reader (T-14.3). Mirrors the
 * on-disk row shape minus `chapter_id` (the caller already knows
 * the chapter), with the phrase's `glossDefault` and the viewer's
 * known-status pre-joined so the reader renders in one pass.
 */
export type RenderedPhraseSpan = {
  phraseId: string;
  startTokenIdx: number;
  endTokenIdx: number;
  /** Joined from `phrases.gloss_default`. Null if the phrase has
   *  no gloss on file. */
  glossDefault: string | null;
  /** Joined from `user_known_phrases`. Anonymous viewers default
   *  to 'unknown'. */
  status: 'known' | 'learning' | 'ignored' | 'unknown';
};

/**
 * Sibling loader to `loadChapterTokens` (T-5.2). The reader page-
 * server (T-14.3) calls both — keeping this as a parallel export
 * rather than threading an extra return value through every
 * existing `loadChapterTokens` consumer keeps the diff small and
 * the failure modes independent: a phrase-spans rebuild crashing
 * mid-test never breaks the existing token rendering path.
 *
 * Returns an empty array when the chapter has no spans (also the
 * common case for chapters processed before T-14.2 lands).
 */
export async function loadChapterPhraseSpans(
  chapterId: string,
  viewerId: string | null,
): Promise<RenderedPhraseSpan[]> {
  const spanRows = (await db
    .select({
      phraseId: schema.phraseChapterSpans.phraseId,
      startTokenIdx: schema.phraseChapterSpans.startTokenIdx,
      endTokenIdx: schema.phraseChapterSpans.endTokenIdx,
    })
    .from(schema.phraseChapterSpans)
    .where(eq(schema.phraseChapterSpans.chapterId, chapterId))) as Array<{
    phraseId: string;
    startTokenIdx: number;
    endTokenIdx: number;
  }>;
  if (spanRows.length === 0) return [];

  const phraseIds = Array.from(new Set(spanRows.map((s) => s.phraseId)));

  // Hydrate gloss in one SELECT — phrases.gloss_default is the
  // tooltip surface for hover state in T-14.3.
  const phraseMetaRows = (await db
    .select({
      id: schema.phrases.id,
      glossDefault: schema.phrases.glossDefault,
    })
    .from(schema.phrases)
    .where(inArray(schema.phrases.id, phraseIds))) as Array<{
    id: string;
    glossDefault: string | null;
  }>;
  const glossById = new Map<string, string | null>();
  for (const r of phraseMetaRows) glossById.set(r.id, r.glossDefault);

  // Hydrate per-user status. Anonymous viewers (or viewers with no
  // user_known_phrases row for these phrases) see 'unknown'.
  const statusByPhrase = new Map<
    string,
    'known' | 'learning' | 'ignored' | 'unknown'
  >();
  if (viewerId) {
    const statusRows = (await db
      .select({
        phraseId: schema.userKnownPhrases.phraseId,
        status: schema.userKnownPhrases.status,
      })
      .from(schema.userKnownPhrases)
      .where(eq(schema.userKnownPhrases.userId, viewerId))) as Array<{
      phraseId: string;
      status: 'unknown' | 'learning' | 'known' | 'ignored';
    }>;
    const wanted = new Set(phraseIds);
    for (const r of statusRows) {
      if (wanted.has(r.phraseId)) statusByPhrase.set(r.phraseId, r.status);
    }
  }

  return spanRows.map((s) => ({
    phraseId: s.phraseId,
    startTokenIdx: s.startTokenIdx,
    endTokenIdx: s.endTokenIdx,
    glossDefault: glossById.get(s.phraseId) ?? null,
    status: statusByPhrase.get(s.phraseId) ?? 'unknown',
  }));
}

/** Used by tests to read the rebuild result without re-querying. */
export type RebuiltSpansRow = PhraseChapterSpan;
