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
};

export type ListPage = {
  cards: LibraryCard[];
  totalCount: number;
  limit: number;
  offset: number;
};

function projectCard(row: Text): LibraryCard {
  return {
    id: row.id,
    title: row.title,
    language: row.language,
    sourceType: row.sourceType,
    status: row.status,
    visibility: row.visibility,
    createdAt: row.createdAt,
  };
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
 * The user's own imports, newest first.
 */
export async function listOwnedTexts(
  viewer: Pick<User, 'id'>,
  opts: { limit?: number; offset?: number; language?: LanguageCode } = {},
): Promise<ListPage> {
  const { limit, offset } = clampPage(opts);
  const conditions = [eq(schema.texts.ownerId, viewer.id)];
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
    cards: rows.map(projectCard),
    totalCount: count,
    limit,
    offset,
  };
}

/**
 * Texts shared with the viewer (T-7.x). Until those sharing tables
 * land, we return an empty page so the library tab renders without a
 * special-case "M7 not implemented yet" branch in the UI.
 */
export async function listSharedTexts(
  _viewer: Pick<User, 'id'>,
  opts: { limit?: number; offset?: number } = {},
): Promise<ListPage> {
  const { limit, offset } = clampPage(opts);
  return { cards: [], totalCount: 0, limit, offset };
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
  const conditions = [eq(schema.texts.visibility, 'official')];
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
    cards: rows.map(projectCard),
    totalCount: count,
    limit,
    offset,
  };
}
