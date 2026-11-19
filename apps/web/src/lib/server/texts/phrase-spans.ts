/**
 * Match phrases within sentences after a chapter's tokens have been saved. Keep overlapping
 * matches so the reader can choose what to highlight without running the search again.
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

/** Rebuild the chapter's matches after processing its words, including when a chapter is reprocessed. */
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
 * Public projection consumed by the reader. Mirrors the
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

/** Load chapter matches with the current reader's phrase statuses. */
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

  // Load the short definitions together for use in phrase tooltips.
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
