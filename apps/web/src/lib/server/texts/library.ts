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
import { and, desc, eq, sql } from 'drizzle-orm';

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
  };
}

/**
 * Decorate the page's rows with the viewer's estimated comprehension
 * in a single bulk query (one round-trip for the whole page, not one
 * per card). Returns plain projections with null comprehension when
 * there's no viewer (the unauthenticated official listing).
 */
async function projectCardsWithComprehension(
  rows: Text[],
  viewerId: string | null,
): Promise<LibraryCard[]> {
  if (rows.length === 0 || !viewerId) {
    return rows.map((r) => projectCard(r));
  }
  const byText = await estimatedComprehensionForTexts(
    viewerId,
    rows.map((r) => r.id),
  );
  return rows.map((r) => projectCard(r, byText.get(r.id) ?? null));
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

  return {
    cards: await projectCardsWithComprehension(rows, viewer.id),
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

  return {
    cards: await projectCardsWithComprehension(rows, viewer.id),
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

  // Official listing is unauthenticated — no viewer to score against,
  // so comprehension stays null.
  return {
    cards: await projectCardsWithComprehension(rows, null),
    totalCount: count,
    limit,
    offset,
  };
}
