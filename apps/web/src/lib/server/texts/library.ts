import { officialCatalog, catalogEntries, NOT_A_CHAPTER_BOOK_MEMBER } from './official-catalog.js';
import { cachedBookScores, ensureReaderCoverage } from './reader-coverage.js';
import { scoreBookEntries, unparsedWordCount, type BookWordStats } from './book-stats.js';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import type { Text, User } from '../db/schema.js';
import type { LanguageCode } from '@ciareader/shared-types';
import { estimatedComprehensionForTexts } from '../learning-stats.js';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** Card-shaped projection — what the library renders per row. The
 * full row would carry chapter bodies through the loader, which we
 * don't need on the index. */
export type LibraryCard = {
  id: string;
  title: string;
  language: string;
  sourceType: string;
  status: string;
  visibility: string;
  createdAt: Date;
  /** Estimated comprehension for `viewer` (0–100 int), or null when
   *  the text has no tokens yet (worker hasn't run) so the UI can show
   *  a dash rather than 0%. Always null for the unauthenticated
   *  official listing — there's no viewer to score against. */
  estimatedComprehensionPct: number | null;
  /** The viewer's reading progress through this text, 0–100. 0 when unread or
   *  for anonymous/official listings. */
  progressPct: number;
};

export type ListPage = {
  cards: LibraryCard[];
  totalCount: number;
  limit: number;
  offset: number;
};

function projectCard(
  row: Text,
  estimatedComprehensionPct: number | null = null,
  progressPct = 0,
): LibraryCard {
  return {
    id: row.id,
    title: row.title,
    language: row.language,
    sourceType: row.sourceType,
    status: row.status,
    visibility: row.visibility,
    createdAt: row.createdAt,
    estimatedComprehensionPct,
    progressPct: Math.round(progressPct),
  };
}

/** The viewer's reading progress (pct_read, 0–100) for the given text ids. */
async function progressByText(
  userId: string,
  textIds: string[],
): Promise<Map<string, number>> {
  if (textIds.length === 0) return new Map();
  const rows = (await db
    .select({
      textId: schema.userTextProgress.textId,
      pctRead: schema.userTextProgress.pctRead,
    })
    .from(schema.userTextProgress)
    .where(
      and(
        eq(schema.userTextProgress.userId, userId),
        inArray(schema.userTextProgress.textId, textIds),
      ),
    )) as Array<{ textId: string; pctRead: number }>;
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.textId, r.pctRead);
  return m;
}

function clampPage(opts: { limit?: number; offset?: number }): {
  limit: number;
  offset: number;
} {
  const limit = Math.min(
    Math.max(opts.limit ?? DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE,
  );
  const offset = Math.max(opts.offset ?? 0, 0);
  return { limit, offset };
}

export type LibraryGridCard = Pick<LibraryCard,
  'id' | 'title' | 'language' | 'sourceType' | 'status' | 'visibility'
> & { chapterCount?: number | null };

/** Rank books and standalone texts together before taking a page. */
export async function listPersonalLibrary(
  viewer: Pick<User, 'id'>,
  opts: { limit?: number; offset?: number; language?: LanguageCode; query?: string },
) {
  const { limit, offset } = clampPage(opts);
  const language = opts.language;
  const rows = await db.execute<{ total: number; cards: LibraryGridCard[] }>(sql`
    WITH items AS (
      SELECT texts.id, texts.title, texts.language, texts.visibility::text, texts.source_type::text AS "sourceType",
             texts.status::text, NULL::int AS "chapterCount", texts.created_at,
             coalesce(p.last_opened_at, p.updated_at) AS opened
      FROM texts LEFT JOIN user_text_progress p ON p.text_id = texts.id AND p.user_id = ${viewer.id}
      WHERE texts.owner_id = ${viewer.id} AND ${NOT_A_CHAPTER_BOOK_MEMBER}
        ${language ? sql`AND texts.language = ${language}` : sql``}
      UNION ALL
      SELECT c.id, c.title, c.language, c.visibility::text, 'book', '', count(ci.text_id)::int,
             c.created_at, max(coalesce(p.last_opened_at, p.updated_at))
      FROM collections c LEFT JOIN collection_items ci ON ci.collection_id = c.id
      LEFT JOIN user_text_progress p ON p.text_id = ci.text_id AND p.user_id = ${viewer.id}
      WHERE c.owner_id = ${viewer.id} AND c.kind = 'chapter_book'
        ${language ? sql`AND c.language = ${language}` : sql``}
      GROUP BY c.id
    ), matches AS (
      SELECT * FROM items
      ${opts.query ? sql`WHERE strpos(lower(title), lower(${opts.query})) > 0` : sql``}
    ), page AS (
      SELECT * FROM matches ORDER BY opened DESC NULLS LAST, created_at DESC, id
      LIMIT ${limit} OFFSET ${offset}
    )
    SELECT (SELECT count(*)::int FROM matches) AS total,
      coalesce(jsonb_agg(to_jsonb(page) - 'opened' - 'created_at'
        ORDER BY opened DESC NULLS LAST, created_at DESC, id), '[]'::jsonb) AS cards
    FROM page
  `);
  return { cards: rows[0]?.cards ?? [], totalCount: rows[0]?.total ?? 0, limit, offset };
}

/**
 * The user's own imports, newest first.
 */
export async function listOwnedTexts(
  viewer: Pick<User, 'id'>,
  opts: { limit?: number; offset?: number; language?: LanguageCode } = {},
): Promise<ListPage> {
  const { limit, offset } = clampPage(opts);
  const conditions = [eq(schema.texts.ownerId, viewer.id), NOT_A_CHAPTER_BOOK_MEMBER];
  if (opts.language) {
    conditions.push(eq(schema.texts.language, opts.language));
  }
  const where = and(...conditions);

  const countRows = (await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.texts)
    .where(where)) as Array<{ count: number }>;
  const count = countRows[0]?.count ?? 0;

  const rows = (await db
    .select()
    .from(schema.texts)
    .where(where)
    .orderBy(desc(schema.texts.createdAt), schema.texts.id)
    .limit(limit)
    .offset(offset)) as Text[];

  const pageIds = rows.map((r) => r.id);
  const progress = await progressByText(viewer.id, pageIds);
  const comprehension = pageIds.length
    ? await estimatedComprehensionForTexts(viewer.id, pageIds)
    : new Map<string, number | null>();
  return {
    cards: rows.map((r) =>
      projectCard(r, comprehension.get(r.id) ?? null, progress.get(r.id) ?? 0),
    ),
    totalCount: count,
    limit,
    offset,
  };
}

export async function listSharedTexts(
  viewer: Pick<User, 'id'>,
  opts: { limit?: number; offset?: number; language?: LanguageCode } = {},
): Promise<ListPage> {
  const { limit, offset } = clampPage(opts);
  // Find the set of text ids visible to the viewer through sharing.
  const idsRows = (await db.execute(sql<{ id: string }>`
    SELECT DISTINCT id FROM (
      SELECT text_id AS id FROM text_shares
       WHERE shared_with_user_id = ${viewer.id}
      UNION
      SELECT tgs.text_id AS id
        FROM text_group_shares tgs
        INNER JOIN group_memberships gm ON gm.group_id = tgs.group_id
       WHERE gm.user_id = ${viewer.id}
    ) AS shared_ids
  `)) as unknown as Array<{ id: string }> | { rows: Array<{ id: string }> };
  const ids = (Array.isArray(idsRows) ? idsRows : (idsRows.rows ?? [])).map(
    (r) => r.id,
  );
  if (ids.length === 0) {
    return { cards: [], totalCount: 0, limit, offset };
  }

  const conditions = [
    sql`${schema.texts.id} IN (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )})`,
    sql`${schema.texts.ownerId} IS DISTINCT FROM ${viewer.id}`,
    NOT_A_CHAPTER_BOOK_MEMBER,
  ];
  if (opts.language) {
    conditions.push(eq(schema.texts.language, opts.language));
  }
  const where = and(...conditions);

  const countRows = (await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.texts)
    .where(where)) as Array<{ count: number }>;
  const count = countRows[0]?.count ?? 0;

  const rows = (await db
    .select()
    .from(schema.texts)
    .where(where)
    .orderBy(desc(schema.texts.createdAt), schema.texts.id)
    .limit(limit)
    .offset(offset)) as Text[];

  const pageIds = rows.map((r) => r.id);
  const progress = await progressByText(viewer.id, pageIds);
  const comprehension = pageIds.length
    ? await estimatedComprehensionForTexts(viewer.id, pageIds)
    : new Map<string, number | null>();
  return {
    cards: rows.map((r) =>
      projectCard(r, comprehension.get(r.id) ?? null, progress.get(r.id) ?? 0),
    ),
    totalCount: count,
    limit,
    offset,
  };
}

/**
 * Officially published texts, optionally filtered by language. Public —
 * the loader does not require an authenticated viewer. The public
 * `/library` tab + the unauth `/library/official` route both consume
 * this.
 */
export async function listOfficialTexts(
  opts: { limit?: number; offset?: number; language?: LanguageCode } = {},
): Promise<ListPage> {
  const { limit, offset } = clampPage(opts);
  const conditions = [eq(schema.texts.visibility, 'official'), NOT_A_CHAPTER_BOOK_MEMBER];
  if (opts.language) {
    conditions.push(eq(schema.texts.language, opts.language));
  }
  const where = and(...conditions);

  const countRows = (await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.texts)
    .where(where)) as Array<{ count: number }>;
  const count = countRows[0]?.count ?? 0;

  const rows = (await db
    .select()
    .from(schema.texts)
    .where(where)
    .orderBy(desc(schema.texts.createdAt), schema.texts.id)
    .limit(limit)
    .offset(offset)) as Text[];

  // Official listing is unauthenticated — no viewer to score against, so
  // comprehension stays null and progress 0.
  return {
    cards: rows.map((r) => projectCard(r)),
    totalCount: count,
    limit,
    offset,
  };
}

export type CoverageSort = 'reading' | 'unique' | 'recent';

export function catalogSort(value: string | null, userId?: string): CoverageSort {
  if (!userId || value === 'recent') return 'recent';
  return value === 'unique' ? 'unique' : 'reading';
}

export async function listOfficialBooks(opts: {
  language?: LanguageCode; userId?: string; sort: CoverageSort; limit: number; offset: number;
}) {
  type Card = LibraryGridCard & { stats: BookWordStats | null };
  const { limit, offset } = clampPage(opts);
  const order = opts.sort === 'recent' ? sql`created_at DESC, id`
    : sql`${opts.sort === 'unique' ? sql`unique_ratio` : sql`reading_ratio`} DESC NULLS LAST, title, id`;
  if (opts.userId) await ensureReaderCoverage(opts.userId);
  const rows = await db.execute<{ cards: Card[]; total: number }>(sql`
    WITH catalog AS (${officialCatalog(opts.language)}), candidates AS (
      SELECT * FROM catalog
      ${opts.sort === 'recent' ? sql`ORDER BY created_at DESC, id LIMIT ${limit} OFFSET ${offset}` : sql``}
    ), scores AS (
      ${opts.userId ? cachedBookScores(opts.userId) : sql`
        WITH entries AS (${catalogEntries}) ${scoreBookEntries()}
      `}
    ), page AS (
      SELECT c.*,s.reading_ratio,s.unique_ratio,
        CASE WHEN s.id IS NOT NULL THEN jsonb_build_object(
          'words', s.words, 'uniqueWords', s."uniqueWords", 'unresolved', s.unresolved,
          'unparsedWords', ${unparsedWordCount(sql`
            SELECT c.id WHERE c."chapterCount" IS NULL
            UNION ALL SELECT ci.text_id FROM collection_items ci
            WHERE c."chapterCount" IS NOT NULL AND ci.collection_id = c.id
          `)},
          'knownWords', s."knownWords", 'learningWords', s."learningWords",
          'knownHeadwords', s."knownHeadwords", 'learningHeadwords', s."learningHeadwords",
          'knownPct', round(100*s.reading_ratio,1), 'learningPct', round(100*s.learning_ratio,1),
          'uniquePct', round(100*s.unique_ratio,1)) END AS stats
      FROM candidates c LEFT JOIN scores s USING(id)
      ORDER BY ${order} LIMIT ${limit} OFFSET ${opts.sort === 'recent' ? 0 : offset}
    )
    SELECT (SELECT count(*)::int FROM catalog) AS total,
      coalesce(jsonb_agg(to_jsonb(page) - 'created_at' - 'reading_ratio' - 'unique_ratio' ORDER BY ${order}), '[]') AS cards
    FROM page
  `);
  return { cards: rows[0]?.cards ?? [], totalCount: rows[0]?.total ?? 0, limit, offset };
}
