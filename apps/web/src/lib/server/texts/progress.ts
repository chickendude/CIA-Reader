/**
 * Save reading progress per reader and text. The reader supplies the percentage because it knows
 * how the chapter is displayed.
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

async function requireReadableText(userId: string, textId: string) {
  const [text] = await db
    .select()
    .from(schema.texts)
    .where(eq(schema.texts.id, textId))
    .limit(1);
  if (!text) throw new ProgressNotAccessibleError();
  const ok = await canReadText({ id: userId }, text as Text);
  if (!ok) throw new ProgressNotAccessibleError();
}

export async function recordTextOpened(userId: string, textId: string) {
  await requireReadableText(userId, textId);
  const lastOpenedAt = new Date();
  await db.insert(schema.userTextProgress)
    .values({ userId, textId, lastOpenedAt })
    .onConflictDoUpdate({
      target: [schema.userTextProgress.userId, schema.userTextProgress.textId],
      set: { lastOpenedAt },
    });
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
  await requireReadableText(args.userId, args.textId);

  // Clamp inputs defensively — a bad client shouldn't be able to
  // store nonsense.
  const lastChapterIdx = Math.max(0, Math.floor(args.lastChapterIdx));
  const lastTokenIdx = Math.max(0, Math.floor(args.lastTokenIdx));
  const pctRead = Math.max(0, Math.min(100, Number(args.pctRead) || 0));

  const anchor = { lastChapterIdx, lastTokenIdx, pctRead, updatedAt: now };
  const [saved] = await db.insert(schema.userTextProgress)
    .values({ userId: args.userId, textId: args.textId, ...anchor })
    .onConflictDoUpdate({
      target: [schema.userTextProgress.userId, schema.userTextProgress.textId],
      set: anchor,
    })
    .returning();
  if (!saved) throw new Error('Failed to save reading progress');
  return saved;
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
