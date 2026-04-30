/**
 * Learning stats (T-10.1).
 *
 * Per-language: known / learning / encountered lemma counts plus a
 * per-text breakdown with estimated comprehension. T-10.2's library
 * card badge reads `estimatedComprehensionForText` directly so the
 * grid lookup stays cheap.
 *
 * Estimated comprehension is the fraction of word-token occurrences
 * whose lemma the user has marked 'known' — it answers "how much of
 * this page would I already understand?" and changes meaningfully
 * as the user marks words.
 */
import { sql } from 'drizzle-orm';

import { db } from './db/index.js';
import type { LanguageCode } from '@ciareader/shared-types';

export type LanguageStats = {
  knownCount: number;
  learningCount: number;
  ignoredCount: number;
  listeningMinutes: number;
  /** Distinct lemmas seen at least once across the user's owned
   *  texts in this language. */
  encounteredCount: number;
};

export const STATS_DEFAULT_PAGE_SIZE = 50;
export const STATS_MAX_PAGE_SIZE = 100;

export type StatsPageOptions = {
  limit?: number;
  offset?: number;
};

export function clampStatsPage(opts: StatsPageOptions = {}): {
  limit: number;
  offset: number;
} {
  return {
    limit: Math.min(
      Math.max(opts.limit ?? STATS_DEFAULT_PAGE_SIZE, 1),
      STATS_MAX_PAGE_SIZE,
    ),
    offset: Math.max(opts.offset ?? 0, 0),
  };
}

function unwrapRows<T>(out: unknown): T[] {
  if (Array.isArray(out)) return out as T[];
  if (out && typeof out === 'object' && 'rows' in out) {
    const rows = (out as { rows?: T[] }).rows;
    if (Array.isArray(rows)) return rows;
  }
  return [];
}

function msToMinutes(ms: number | string | null | undefined): number {
  return Math.round((Number(ms ?? 0) / 60_000) * 10) / 10;
}

export async function getLanguageStats(
  userId: string,
  language: LanguageCode,
): Promise<LanguageStats> {
  const counts = unwrapRows<{
    known: number;
    learning: number;
    ignored: number;
  }>(
    await db.execute(sql`
      SELECT
        SUM(CASE WHEN ukl.status = 'known' THEN 1 ELSE 0 END)::int AS known,
        SUM(CASE WHEN ukl.status = 'learning' THEN 1 ELSE 0 END)::int AS learning,
        SUM(CASE WHEN ukl.status = 'ignored' THEN 1 ELSE 0 END)::int AS ignored
      FROM user_known_lemmas ukl
      INNER JOIN lemmas l ON l.id = ukl.lemma_id
      WHERE ukl.user_id = ${userId}
        AND l.language = ${language}
    `),
  );
  const row = counts[0] ?? { known: 0, learning: 0, ignored: 0 };

  // Distinct lemmas the user has *encountered* in their owned
  // texts. Counts distinct lemma_id over text_tokens joined back to
  // texts the user owns. Stays language-bound so cross-language
  // shares (when M7 sharing lands) don't pollute the count.
  const encountered = unwrapRows<{ n: number }>(
    await db.execute(sql`
      SELECT COUNT(DISTINCT tt.lemma_id)::int AS n
      FROM text_tokens tt
      INNER JOIN text_chapters ch ON ch.id = tt.chapter_id
      INNER JOIN texts tx ON tx.id = ch.text_id
      WHERE tx.owner_id = ${userId}
        AND tx.language = ${language}
        AND tt.lemma_id IS NOT NULL
    `),
  );
  const encounteredCount = encountered[0]?.n ?? 0;

  const listening = unwrapRows<{ listened_ms: number | string | null }>(
    await db.execute(sql`
      SELECT COALESCE(SUM(ual.listened_ms), 0)::bigint AS listened_ms
      FROM user_audio_listening ual
      INNER JOIN texts tx ON tx.id = ual.text_id
      WHERE ual.user_id = ${userId}
        AND tx.language = ${language}
    `),
  );

  return {
    knownCount: row.known ?? 0,
    learningCount: row.learning ?? 0,
    ignoredCount: row.ignored ?? 0,
    encounteredCount,
    listeningMinutes: msToMinutes(listening[0]?.listened_ms),
  };
}

export type TextStats = {
  textId: string;
  title: string;
  language: LanguageCode;
  uniqueLemmas: number;
  totalWords: number;
  estimatedComprehensionPct: number;
  listeningMinutes: number;
};

/**
 * Per-text breakdown for the user. `estimatedComprehensionPct` is
 * the fraction of word-token occurrences whose lemma the user has
 * marked 'known' — known-lemma occurrences ÷ total word occurrences.
 *
 * The query joins text_tokens with the user's known_lemmas and
 * counts both 'how many tokens overall' and 'how many tokens whose
 * lemma is known'. We compute over OCCURRENCES (not distinct
 * lemmas) because comprehension is a function of how often the
 * known words actually appear in the text — knowing one ultra-
 * frequent verb is worth dozens of rare ones.
 */
export async function listTextStats(
  userId: string,
  language: LanguageCode,
  opts: StatsPageOptions = {},
): Promise<TextStats[]> {
  const { limit, offset } = clampStatsPage(opts);
  const list = unwrapRows<{
    text_id: string;
    title: string;
    language: LanguageCode;
    unique_lemmas: number;
    total_words: number;
    known_words: number;
    listened_ms: number | string | null;
  }>(
    await db.execute(sql`
      SELECT
        tx.id AS text_id,
        tx.title AS title,
        tx.language AS language,
        COUNT(DISTINCT tt.lemma_id) FILTER (WHERE tt.lemma_id IS NOT NULL)::int AS unique_lemmas,
        COUNT(*) FILTER (WHERE tt.is_word = true)::int AS total_words,
        COUNT(*) FILTER (
          WHERE tt.is_word = true
            AND tt.lemma_id IS NOT NULL
            AND ukl.status = 'known'
        )::int AS known_words,
        (
          SELECT COALESCE(SUM(ual.listened_ms), 0)::bigint
          FROM user_audio_listening ual
          WHERE ual.user_id = ${userId}
            AND ual.text_id = tx.id
        ) AS listened_ms
      FROM texts tx
      INNER JOIN text_chapters ch ON ch.text_id = tx.id
      INNER JOIN text_tokens tt ON tt.chapter_id = ch.id
      LEFT JOIN user_known_lemmas ukl
        ON ukl.lemma_id = tt.lemma_id AND ukl.user_id = ${userId}
      WHERE tx.owner_id = ${userId}
        AND tx.language = ${language}
      GROUP BY tx.id, tx.title, tx.language
      ORDER BY tx.created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `),
  );
  return list.map((r) => ({
    textId: r.text_id,
    title: r.title,
    language: r.language,
    uniqueLemmas: r.unique_lemmas,
    totalWords: r.total_words,
    estimatedComprehensionPct:
      r.total_words === 0
        ? 0
        : Math.round((r.known_words / r.total_words) * 100),
    listeningMinutes: msToMinutes(r.listened_ms),
  }));
}

/**
 * Bulk version of `estimatedComprehensionForText` for the library
 * grid (T-10.2). Returns a map keyed by textId so the loader can
 * decorate each card with one query instead of N. Texts in the
 * input set that have no tokens (worker hasn't run) are mapped
 * to null; the UI shows a dash rather than a 0%.
 */
export async function estimatedComprehensionForTexts(
  userId: string,
  textIds: string[],
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  if (textIds.length === 0) return out;
  const list = unwrapRows<{
    text_id: string;
    total: number;
    known: number;
  }>(
    await db.execute(sql`
      SELECT
        ch.text_id AS text_id,
        COUNT(*) FILTER (WHERE tt.is_word = true)::int AS total,
        COUNT(*) FILTER (
          WHERE tt.is_word = true
            AND tt.lemma_id IS NOT NULL
            AND ukl.status = 'known'
        )::int AS known
      FROM text_chapters ch
      INNER JOIN text_tokens tt ON tt.chapter_id = ch.id
      LEFT JOIN user_known_lemmas ukl
        ON ukl.lemma_id = tt.lemma_id AND ukl.user_id = ${userId}
      WHERE ch.text_id IN (${sql.join(
        textIds.map((id) => sql`${id}`),
        sql`, `,
      )})
      GROUP BY ch.text_id
    `),
  );
  for (const r of list) {
    out.set(
      r.text_id,
      r.total === 0 ? null : Math.round((r.known / r.total) * 100),
    );
  }
  // Texts without text_chapters / text_tokens (pre-worker uploads)
  // simply don't appear in `list` — record null so the UI can
  // distinguish "not processed yet" from 0%.
  for (const id of textIds) {
    if (!out.has(id)) out.set(id, null);
  }
  return out;
}

/**
 * Single-text comprehension lookup for the library card badge
 * (T-10.2). Cheap — same shape as one row of listTextStats but
 * scoped to a single textId so the library grid can fan out one
 * query per card without a wide join.
 */
export async function estimatedComprehensionForText(
  userId: string,
  textId: string,
): Promise<number | null> {
  const list = unwrapRows<{ total: number; known: number }>(
    await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE tt.is_word = true)::int AS total,
        COUNT(*) FILTER (
          WHERE tt.is_word = true
            AND tt.lemma_id IS NOT NULL
            AND ukl.status = 'known'
        )::int AS known
      FROM text_tokens tt
      INNER JOIN text_chapters ch ON ch.id = tt.chapter_id
      LEFT JOIN user_known_lemmas ukl
        ON ukl.lemma_id = tt.lemma_id AND ukl.user_id = ${userId}
      WHERE ch.text_id = ${textId}
    `),
  );
  const r = list[0];
  if (!r || r.total === 0) return null;
  return Math.round((r.known / r.total) * 100);
}

export type CollectionStats = {
  collectionId: string;
  title: string;
  textCount: number;
  estimatedComprehensionPct: number;
  listeningMinutes: number;
};

/** Bulk comprehension for the collections grid (T-10.2). */
export async function estimatedComprehensionForCollections(
  userId: string,
  collectionIds: string[],
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  if (collectionIds.length === 0) return out;
  const list = unwrapRows<{
    collection_id: string;
    total: number;
    known: number;
  }>(
    await db.execute(sql`
      SELECT
        ci.collection_id AS collection_id,
        COUNT(*) FILTER (WHERE tt.is_word = true)::int AS total,
        COUNT(*) FILTER (
          WHERE tt.is_word = true
            AND tt.lemma_id IS NOT NULL
            AND ukl.status = 'known'
        )::int AS known
      FROM collection_items ci
      INNER JOIN text_chapters ch ON ch.text_id = ci.text_id
      INNER JOIN text_tokens tt ON tt.chapter_id = ch.id
      LEFT JOIN user_known_lemmas ukl
        ON ukl.lemma_id = tt.lemma_id AND ukl.user_id = ${userId}
      WHERE ci.collection_id IN (${sql.join(
        collectionIds.map((id) => sql`${id}`),
        sql`, `,
      )})
      GROUP BY ci.collection_id
    `),
  );
  for (const r of list) {
    out.set(
      r.collection_id,
      r.total === 0 ? null : Math.round((r.known / r.total) * 100),
    );
  }
  for (const id of collectionIds) {
    if (!out.has(id)) out.set(id, null);
  }
  return out;
}

/**
 * Per-collection breakdown for the user. Aggregates over every
 * text in the collection — same comprehension formula as
 * listTextStats, just with a wider GROUP BY.
 */
export async function listCollectionStats(
  userId: string,
  language: LanguageCode,
  opts: StatsPageOptions = {},
): Promise<CollectionStats[]> {
  const { limit, offset } = clampStatsPage(opts);
  const list = unwrapRows<{
    collection_id: string;
    title: string;
    text_count: number;
    total_words: number;
    known_words: number;
    listened_ms: number | string | null;
  }>(
    await db.execute(sql`
      SELECT
        c.id AS collection_id,
        c.title AS title,
        COUNT(DISTINCT ci.text_id)::int AS text_count,
        COUNT(*) FILTER (WHERE tt.is_word = true)::int AS total_words,
        COUNT(*) FILTER (
          WHERE tt.is_word = true
            AND tt.lemma_id IS NOT NULL
            AND ukl.status = 'known'
        )::int AS known_words,
        (
          SELECT COALESCE(SUM(ual.listened_ms), 0)::bigint
          FROM user_audio_listening ual
          INNER JOIN collection_items ci2 ON ci2.text_id = ual.text_id
          WHERE ual.user_id = ${userId}
            AND ci2.collection_id = c.id
        ) AS listened_ms
      FROM collections c
      INNER JOIN collection_items ci ON ci.collection_id = c.id
      INNER JOIN text_chapters ch ON ch.text_id = ci.text_id
      INNER JOIN text_tokens tt ON tt.chapter_id = ch.id
      LEFT JOIN user_known_lemmas ukl
        ON ukl.lemma_id = tt.lemma_id AND ukl.user_id = ${userId}
      WHERE c.owner_id = ${userId}
        AND c.language = ${language}
      GROUP BY c.id, c.title
      ORDER BY c.updated_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `),
  );
  return list.map((r) => ({
    collectionId: r.collection_id,
    title: r.title,
    textCount: r.text_count,
    estimatedComprehensionPct:
      r.total_words === 0
        ? 0
        : Math.round((r.known_words / r.total_words) * 100),
    listeningMinutes: msToMinutes(r.listened_ms),
  }));
}
