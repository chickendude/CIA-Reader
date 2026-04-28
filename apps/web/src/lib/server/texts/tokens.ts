/**
 * Reader token + known-status loader (T-5.2).
 *
 * The NLP worker writes `text_tokens` rows during processing
 * (T-2.6). Once the worker has run, the reader pulls those rows + a
 * join through `user_known_lemmas` so each token can render with the
 * right `.status-*` class.
 *
 * Until the worker runs, `loadChapterTokens` returns `null` for
 * chapters with no rows yet — the reader falls back to its
 * client-side whitespace tokenizer in that case (still readable, just
 * no lemma colouring).
 */
import { and, eq, inArray, isNotNull } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import type { TextToken, UserKnownLemma } from '../db/schema.js';

export type RenderedToken = {
  id: string;
  idx: number;
  surface: string;
  isWord: boolean;
  isAmbiguous: boolean;
  isOov: boolean;
  lemmaId: string | null;
  romanization: string | null;
  /** Canonical short gloss for the lemma — surfaced in the hover
   *  tooltip (T-5.18) so a reader can scan a paragraph without
   *  locking the side panel. Null when the lemma has no glossDefault
   *  on file, or when the token has no lemma id (whitespace, OOV). */
  glossDefault: string | null;
  status: 'known' | 'learning' | 'ignored' | 'unknown';
};

/**
 * Load every token in a chapter (in reading order) along with the
 * caller's known-status for each lemma. Returns null when no tokens
 * have been written yet — the caller (the reader page) falls back to
 * client-side whitespace tokenization in that case.
 */
export async function loadChapterTokens(
  chapterId: string,
  viewerId: string | null,
): Promise<RenderedToken[] | null> {
  const tokens = (await db
    .select()
    .from(schema.textTokens)
    .where(eq(schema.textTokens.chapterId, chapterId))
    .orderBy(schema.textTokens.idx)) as TextToken[];

  if (tokens.length === 0) return null;

  const lemmaIds = Array.from(
    new Set(tokens.map((t) => t.lemmaId).filter((id): id is string => !!id)),
  );

  // Anonymous viewers have no `user_known_lemmas` rows; every word
  // renders 'unknown'. We still return the tokens so they can be
  // displayed.
  const statusByLemma = new Map<string, UserKnownLemma['status']>();
  if (viewerId && lemmaIds.length > 0) {
    const rows = (await db
      .select()
      .from(schema.userKnownLemmas)
      .where(
        // Composite filter: the user's row, intersected with the
        // lemmas in this chapter. Drizzle's `and` collapses cleanly.
        eq(schema.userKnownLemmas.userId, viewerId),
      )) as UserKnownLemma[];
    // We could've combined with inArray(lemmaId, lemmaIds) at the
    // SQL level, but the index covers (user_id, status) and the
    // viewer rarely has a huge number of known lemmas — filtering
    // in memory is cheap and keeps the query simple.
    const wanted = new Set(lemmaIds);
    for (const r of rows) {
      if (wanted.has(r.lemmaId)) statusByLemma.set(r.lemmaId, r.status);
    }
  }

  // T-5.18: pull each lemma's `glossDefault` so the hover tooltip can
  // surface a brief definition without a per-hover fetch. Cheap — a
  // single SELECT against an indexed primary key.
  //
  // T-3.14: also pull `language` and `headword` so we can fall back
  // to a sibling lemma's gloss when the directly-linked one is empty.
  // Common case: a token tagged PROPN (because it's part of a
  // multi-word proper name) where the dictionary entry actually lives
  // under NOUN. Pre-fix the tooltip said "No translations"; post-fix
  // it shows the sibling NOUN's gloss. Mirrors the popup-side
  // fallback in `getLemmaTranslations` so both surfaces stay in sync.
  const glossByLemma = new Map<string, string | null>();
  const lemmaHeadwords: Array<{
    id: string;
    language: string;
    headword: string;
  }> = [];
  if (lemmaIds.length > 0) {
    const lemmaRows = (await db
      .select({
        id: schema.lemmas.id,
        language: schema.lemmas.language,
        headword: schema.lemmas.headword,
        glossDefault: schema.lemmas.glossDefault,
      })
      .from(schema.lemmas)
      .where(inArray(schema.lemmas.id, lemmaIds))) as Array<{
      id: string;
      language: string;
      headword: string;
      glossDefault: string | null;
    }>;
    for (const r of lemmaRows) {
      glossByLemma.set(r.id, r.glossDefault);
      if (!r.glossDefault) {
        lemmaHeadwords.push({
          id: r.id,
          language: r.language,
          headword: r.headword,
        });
      }
    }
  }

  // Sibling-fallback pass: for any chapter lemma whose own gloss is
  // null, find another lemma with the same (language, headword) that
  // has a non-null gloss and use it. We bucket by (language,
  // headword) so the fallback query is one SELECT regardless of how
  // many tokens are gloss-less, and we only run it when there's
  // actually something to fix.
  if (lemmaHeadwords.length > 0) {
    const headwords = Array.from(new Set(lemmaHeadwords.map((l) => l.headword)));
    const languages = Array.from(new Set(lemmaHeadwords.map((l) => l.language)));
    const siblingRows = (await db
      .select({
        language: schema.lemmas.language,
        headword: schema.lemmas.headword,
        glossDefault: schema.lemmas.glossDefault,
      })
      .from(schema.lemmas)
      .where(
        and(
          inArray(schema.lemmas.language, languages as ('hi' | 'mr' | 'or')[]),
          inArray(schema.lemmas.headword, headwords),
          isNotNull(schema.lemmas.glossDefault),
        ),
      )) as Array<{
      language: string;
      headword: string;
      glossDefault: string | null;
    }>;
    const fallbackByKey = new Map<string, string>();
    for (const r of siblingRows) {
      if (!r.glossDefault) continue;
      const key = `${r.language}\t${r.headword}`;
      if (!fallbackByKey.has(key)) {
        fallbackByKey.set(key, r.glossDefault);
      }
    }
    for (const l of lemmaHeadwords) {
      const key = `${l.language}\t${l.headword}`;
      const fallback = fallbackByKey.get(key);
      if (fallback) glossByLemma.set(l.id, fallback);
    }
  }

  return tokens.map((t) => {
    const status: RenderedToken['status'] =
      t.lemmaId && statusByLemma.has(t.lemmaId)
        ? statusByLemma.get(t.lemmaId)!
        : 'unknown';
    return {
      id: t.id,
      idx: t.idx,
      surface: t.surface,
      isWord: t.isWord,
      isAmbiguous: t.isAmbiguous,
      isOov: t.isOov,
      lemmaId: t.lemmaId,
      romanization: t.romanization,
      glossDefault: t.lemmaId ? glossByLemma.get(t.lemmaId) ?? null : null,
      status,
    };
  });
}

/**
 * Bulk load known-status for a set of lemma ids — used by the
 * client-side tokenizer fallback path so even pre-worker chapters
 * can still highlight known / learning words once the user marks
 * any.
 *
 * Returns a map keyed by lemmaId. Lemmas not in the map are
 * 'unknown' by default.
 */
export async function loadKnownStatusMap(
  viewerId: string | null,
  lemmaIds: string[],
): Promise<Map<string, UserKnownLemma['status']>> {
  if (!viewerId || lemmaIds.length === 0) return new Map();
  const rows = (await db
    .select()
    .from(schema.userKnownLemmas)
    .where(eq(schema.userKnownLemmas.userId, viewerId))) as UserKnownLemma[];
  const wanted = new Set(lemmaIds);
  const out = new Map<string, UserKnownLemma['status']>();
  for (const r of rows) {
    if (wanted.has(r.lemmaId)) out.set(r.lemmaId, r.status);
  }
  return out;
}

/** Rare but useful: every lemma the user has marked, regardless of
 * which chapter it appears in. Used by the stats page (T-10.1). */
export async function listKnownLemmas(
  viewerId: string,
  status?: UserKnownLemma['status'],
): Promise<UserKnownLemma[]> {
  const conditions = status
    ? [
        eq(schema.userKnownLemmas.userId, viewerId),
        eq(schema.userKnownLemmas.status, status),
      ]
    : [eq(schema.userKnownLemmas.userId, viewerId)];
  // Same as above — we can keep the query single-condition + filter
  // in memory if it ever becomes a hot path, but list endpoints don't
  // mind a small extra clause.
  const rows = (await db
    .select()
    .from(schema.userKnownLemmas)
    .where(
      conditions.length === 1
        ? conditions[0]!
        : (await import('drizzle-orm')).and(...conditions)!,
    )) as UserKnownLemma[];
  return rows;
}

// Re-export `inArray` so callers can build composite predicates
// without importing drizzle directly when needed.
export { inArray };

// -----------------------------------------------------------------------
// setKnownLemmaStatus (T-5.5)
// -----------------------------------------------------------------------

/**
 * Upsert the user's known-status for a lemma. The reader's pop-up
 * (T-5.4) wires its Learning / Known / Ignored buttons through this.
 * Recomputes the per-language known-count cache on
 * `user_languages.known_words_count_cache` so the stats card on the
 * profile page is correct without a full scan.
 *
 * Returns the new status row.
 */
export async function setKnownLemmaStatus(args: {
  userId: string;
  lemmaId: string;
  status: 'unknown' | 'learning' | 'known' | 'ignored';
  now?: Date;
}): Promise<UserKnownLemma> {
  const now = args.now ?? new Date();

  // Look up the lemma to find its language — needed for the per-
  // language cache update. A missing lemma is a 404; the caller
  // converts the thrown error.
  const [lemma] = await db
    .select({ id: schema.lemmas.id, language: schema.lemmas.language })
    .from(schema.lemmas)
    .where(eq(schema.lemmas.id, args.lemmaId))
    .limit(1);
  if (!lemma) {
    throw new Error(`Lemma ${args.lemmaId} not found`);
  }
  const language = (lemma as { language: 'hi' | 'mr' | 'or' }).language;

  // Upsert. We can't use Drizzle's onConflictDoUpdate with a composite
  // PK across all our drivers without a lot of ceremony — the simpler
  // path is to read the existing row and conditionally INSERT or
  // UPDATE.
  const existing = (await db
    .select()
    .from(schema.userKnownLemmas)
    .where(eq(schema.userKnownLemmas.userId, args.userId))) as UserKnownLemma[];
  const row = existing.find((r) => r.lemmaId === args.lemmaId);

  let result: UserKnownLemma;
  if (row) {
    const [updated] = (await db
      .update(schema.userKnownLemmas)
      .set({ status: args.status, updatedAt: now })
      .where(
        // Composite PK condition.
        (await import('drizzle-orm')).and(
          eq(schema.userKnownLemmas.userId, args.userId),
          eq(schema.userKnownLemmas.lemmaId, args.lemmaId),
        )!,
      )
      .returning()) as UserKnownLemma[];
    if (!updated) throw new Error('Failed to update user_known_lemmas');
    result = updated;
  } else {
    const [inserted] = (await db
      .insert(schema.userKnownLemmas)
      .values({
        userId: args.userId,
        lemmaId: args.lemmaId,
        status: args.status,
        updatedAt: now,
      })
      .returning()) as UserKnownLemma[];
    if (!inserted) throw new Error('Failed to insert user_known_lemmas');
    result = inserted;
  }

  // Recompute the cache for this user × language. Counted as the
  // number of rows with status='known' for the lemmas in that
  // language.
  const allKnown = (await db
    .select({
      lemmaId: schema.userKnownLemmas.lemmaId,
      language: schema.lemmas.language,
    })
    .from(schema.userKnownLemmas)
    .innerJoin(schema.lemmas, eq(schema.lemmas.id, schema.userKnownLemmas.lemmaId))
    .where(
      (await import('drizzle-orm')).and(
        eq(schema.userKnownLemmas.userId, args.userId),
        eq(schema.userKnownLemmas.status, 'known'),
        eq(schema.lemmas.language, language),
      )!,
    )) as Array<{ lemmaId: string; language: string }>;
  const knownCount = allKnown.length;
  await db
    .update(schema.userLanguages)
    .set({ knownWordsCountCache: knownCount })
    .where(
      (await import('drizzle-orm')).and(
        eq(schema.userLanguages.userId, args.userId),
        eq(schema.userLanguages.language, language),
      )!,
    );

  return result;
}
