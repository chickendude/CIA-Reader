/**
 * Library queries (T-4.5).
 *
 * Three tabs feed off this module:
 *
 *   - "Your texts" — `texts.owner_id = me`. Most recent first.
 *   - "Shared with you" — texts the viewer has access to via M7's
 *     `text_shares` / `text_group_shares` tables. Those tables don't
 *     exist yet, so the function returns an empty page; the M7
 *     ticket plugs the real query in.
 *   - "Official library" — `texts.visibility = 'official'`. Public,
 *     unauthenticated; M11 (T-7.6) wires this into a public-facing
 *     SEO route. T-4.5 ships the data fetch.
 *
 * Pagination is offset-based with sensible caps. Cursor pagination is
 * a future concern when individual users have thousands of imports —
 * for the first year of MVP a learner has a few dozen at most.
 */
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

/**
 * Exclude texts that exist purely as chapters of a chapter-book
 * collection. The collection card carries the user-facing entry point
 * — surfacing each chapter as its own library card would mean a
 * 30-chapter EPUB clutters the index with 30 extra rows.
 *
 * `course` / `anthology` member texts still surface as their own
 * cards: those collections curate standalone texts that the user may
 * also want to find directly.
 */
const NOT_A_CHAPTER_BOOK_MEMBER = sql`NOT EXISTS (
  SELECT 1 FROM collection_items ci
  INNER JOIN collections c ON c.id = ci.collection_id
  WHERE ci.text_id = ${schema.texts.id}
    AND c.kind = 'chapter_book'
)`;

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
    .orderBy(desc(schema.texts.createdAt))
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
 * Texts shared with the viewer (T-7.5). Combines direct shares
 * (text_shares) with group shares (text_group_shares ↔
 * group_memberships). Excludes texts the viewer owns themselves —
 * those land in "Your texts."
 *
 * Implementation: a UNION inside a subquery that surfaces every
 * text id the viewer can read via either path; the outer SELECT
 * pulls the canonical text rows and counts.
 */
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
    .orderBy(desc(schema.texts.createdAt))
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
    .orderBy(desc(schema.texts.createdAt))
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
