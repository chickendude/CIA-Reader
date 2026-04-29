/**
 * Group / classroom dashboard stats (T-7.8).
 *
 * Aggregates reading progress for every member of a group across
 * the texts the owner has shared with the group. Lets a teacher /
 * classroom owner see at a glance who's read what.
 *
 * Owner-or-admin only. Members CAN'T see each other's progress —
 * the dashboard is a teaching surface, not a leaderboard.
 */
import { eq, sql } from 'drizzle-orm';

import { db, schema } from './db/index.js';
import { GroupError } from './groups.js';
import type { Group, User } from './db/schema.js';

export type MemberProgress = {
  userId: string;
  displayName: string | null;
  email: string;
  textId: string;
  textTitle: string;
  pctRead: number;
  lastChapterIdx: number;
  updatedAt: Date | null;
};

export type GroupDashboard = {
  group: Group;
  memberCount: number;
  sharedTextCount: number;
  rows: MemberProgress[];
};

export async function loadGroupDashboard(
  groupId: string,
  actor: Pick<User, 'id' | 'role'>,
): Promise<GroupDashboard> {
  const [group] = (await db
    .select()
    .from(schema.groups)
    .where(eq(schema.groups.id, groupId))
    .limit(1)) as Group[];
  if (!group) throw new GroupError('group not found', 404);
  if (actor.role !== 'admin' && group.ownerId !== actor.id) {
    throw new GroupError('only the owner can view the dashboard', 403);
  }

  // Member + shared-text counts. Run in parallel.
  const [memberCountRows, sharedTextCountRows] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.groupMemberships)
      .where(eq(schema.groupMemberships.groupId, groupId)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.textGroupShares)
      .where(eq(schema.textGroupShares.groupId, groupId)),
  ]);
  const memberCount =
    (memberCountRows as Array<{ n: number }>)[0]?.n ?? 0;
  const sharedTextCount =
    (sharedTextCountRows as Array<{ n: number }>)[0]?.n ?? 0;

  // Per-member progress on every shared text. We left-join so a
  // member who hasn't opened a text yet still appears with
  // pctRead = 0 + last_*_idx = 0.
  const rows = (await db.execute(sql<{
    user_id: string;
    display_name: string | null;
    email: string;
    text_id: string;
    text_title: string;
    pct_read: number;
    last_chapter_idx: number;
    updated_at: Date | null;
  }>`
    SELECT
      gm.user_id AS user_id,
      u.display_name AS display_name,
      u.email AS email,
      tgs.text_id AS text_id,
      t.title AS text_title,
      COALESCE(p.pct_read, 0)::float AS pct_read,
      COALESCE(p.last_chapter_idx, 0)::int AS last_chapter_idx,
      p.updated_at AS updated_at
    FROM group_memberships gm
    INNER JOIN users u ON u.id = gm.user_id
    INNER JOIN text_group_shares tgs ON tgs.group_id = gm.group_id
    INNER JOIN texts t ON t.id = tgs.text_id
    LEFT JOIN user_text_progress p
      ON p.user_id = gm.user_id AND p.text_id = tgs.text_id
    WHERE gm.group_id = ${groupId}
    ORDER BY u.email, t.title
  `)) as unknown as Array<{
    user_id: string;
    display_name: string | null;
    email: string;
    text_id: string;
    text_title: string;
    pct_read: number;
    last_chapter_idx: number;
    updated_at: Date | null;
  }> | { rows: Array<{
    user_id: string;
    display_name: string | null;
    email: string;
    text_id: string;
    text_title: string;
    pct_read: number;
    last_chapter_idx: number;
    updated_at: Date | null;
  }> };
  const list = Array.isArray(rows) ? rows : (rows.rows ?? []);

  return {
    group,
    memberCount,
    sharedTextCount,
    rows: list.map((r) => ({
      userId: r.user_id,
      displayName: r.display_name,
      email: r.email,
      textId: r.text_id,
      textTitle: r.text_title,
      pctRead: r.pct_read,
      lastChapterIdx: r.last_chapter_idx,
      updatedAt: r.updated_at,
    })),
  };
}
