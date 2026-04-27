/**
 * Reading-progress service (T-5.6).
 *
 * The reader writes this debounced as the user scrolls / paginates,
 * so a tab refresh resumes at the right anchor and the library card
 * can show "Page 4 of 12 — 30% read" without a separate scan over
 * tokens.
 *
 * The pct_read field is computed by the caller (the reader knows
 * which chapter it's on and how many chapters there are); the server
 * just stores it. Future tickets that compute it from the actual
 * token offset can do so without changing this contract.
 */
import { and, eq } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import type { Text, UserTextProgress } from '../db/schema.js';
import { canReadText } from '../auth/can-read.js';

export class ProgressNotAccessibleError extends Error {
  constructor() {
    super('Text not found');
    this.name = 'ProgressNotAccessibleError';
  }
}

export async function setTextProgress(args: {
  userId: string;
  textId: string;
  lastChapterIdx: number;
  lastTokenIdx: number;
  pctRead: number;
  now?: Date;
}): Promise<UserTextProgress> {
  const now = args.now ?? new Date();

  // Authorization runs through canReadText so we can't be tricked
  // into writing progress for a text the viewer can't actually read.
  const [text] = await db
    .select()
    .from(schema.texts)
    .where(eq(schema.texts.id, args.textId))
    .limit(1);
  if (!text) throw new ProgressNotAccessibleError();
  const ok = await canReadText({ id: args.userId }, text as Text);
  if (!ok) throw new ProgressNotAccessibleError();

  // Clamp inputs defensively — a bad client shouldn't be able to
  // store nonsense.
  const lastChapterIdx = Math.max(0, Math.floor(args.lastChapterIdx));
  const lastTokenIdx = Math.max(0, Math.floor(args.lastTokenIdx));
  const pctRead = Math.max(0, Math.min(100, Number(args.pctRead) || 0));

  const existing = (await db
    .select()
    .from(schema.userTextProgress)
    .where(
      and(
        eq(schema.userTextProgress.userId, args.userId),
        eq(schema.userTextProgress.textId, args.textId),
      ),
    )
    .limit(1)) as UserTextProgress[];

  if (existing.length > 0) {
    const [updated] = (await db
      .update(schema.userTextProgress)
      .set({
        lastChapterIdx,
        lastTokenIdx,
        pctRead,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.userTextProgress.userId, args.userId),
          eq(schema.userTextProgress.textId, args.textId),
        ),
      )
      .returning()) as UserTextProgress[];
    if (!updated) throw new Error('Failed to update user_text_progress');
    return updated;
  }

  const [inserted] = (await db
    .insert(schema.userTextProgress)
    .values({
      userId: args.userId,
      textId: args.textId,
      lastChapterIdx,
      lastTokenIdx,
      pctRead,
      updatedAt: now,
    })
    .returning()) as UserTextProgress[];
  if (!inserted) throw new Error('Failed to insert user_text_progress');
  return inserted;
}

export async function getTextProgress(
  userId: string,
  textId: string,
): Promise<UserTextProgress | null> {
  const [row] = (await db
    .select()
    .from(schema.userTextProgress)
    .where(
      and(
        eq(schema.userTextProgress.userId, userId),
        eq(schema.userTextProgress.textId, textId),
      ),
    )
    .limit(1)) as UserTextProgress[];
  return row ?? null;
}
