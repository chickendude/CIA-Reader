/**
 * Translation voting service (T-10.4).
 *
 * Votes are intentionally scoped to community translations. Official and
 * curator translations keep their existing curated ordering; a user's own
 * personal translation is also not a community candidate for that viewer.
 */
import { and, eq, sql } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import type { Translation } from '../db/schema.js';

export type TranslationVoteValue = 'up' | 'down';

export type TranslationVoteSummary = {
  translationId: string;
  vote: TranslationVoteValue | null;
  score: number;
};

export class TranslationVoteError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404 = 400,
  ) {
    super(message);
    this.name = 'TranslationVoteError';
  }
}

function unwrapRows<T>(out: unknown): T[] {
  if (Array.isArray(out)) return out as T[];
  if (out && typeof out === 'object' && 'rows' in out) {
    const rows = (out as { rows?: T[] }).rows;
    if (Array.isArray(rows)) return rows;
  }
  return [];
}

async function getTranslation(translationId: string): Promise<Translation> {
  const [row] = await db
    .select()
    .from(schema.translations)
    .where(eq(schema.translations.id, translationId))
    .limit(1);
  if (!row) {
    throw new TranslationVoteError(
      `Translation ${translationId} not found`,
      404,
    );
  }
  return row as Translation;
}

function assertCanVote(row: Translation, userId: string): void {
  if (row.source !== 'user') {
    throw new TranslationVoteError(
      'Only community translations can be voted on',
      403,
    );
  }
  if (row.submittedBy === userId) {
    throw new TranslationVoteError(
      'You cannot vote on your own translation',
      403,
    );
  }
  if (row.hidden) {
    throw new TranslationVoteError(
      'Hidden translations cannot be voted on',
      403,
    );
  }
  if (row.isPrivate) {
    throw new TranslationVoteError(
      'Private translations cannot be voted on',
      403,
    );
  }
}

export async function getTranslationVoteSummary(
  translationId: string,
  userId: string,
): Promise<TranslationVoteSummary> {
  const [scoreRow] = unwrapRows<{ score: number | string | null }>(
    await db.execute(sql`
      SELECT COALESCE(
        SUM(CASE WHEN value = 'up' THEN 1 WHEN value = 'down' THEN -1 ELSE 0 END),
        0
      )::int AS score
      FROM translation_votes
      WHERE translation_id = ${translationId}
    `),
  );
  const [voteRow] = await db
    .select({ value: schema.translationVotes.value })
    .from(schema.translationVotes)
    .where(
      and(
        eq(schema.translationVotes.translationId, translationId),
        eq(schema.translationVotes.userId, userId),
      ),
    )
    .limit(1);

  return {
    translationId,
    score: Number(scoreRow?.score ?? 0),
    vote: (voteRow?.value ?? null) as TranslationVoteValue | null,
  };
}

export async function setTranslationVote(
  userId: string,
  translationId: string,
  vote: TranslationVoteValue | null,
  now: Date = new Date(),
): Promise<TranslationVoteSummary> {
  const translation = await getTranslation(translationId);
  assertCanVote(translation, userId);

  if (vote === null) {
    await db
      .delete(schema.translationVotes)
      .where(
        and(
          eq(schema.translationVotes.userId, userId),
          eq(schema.translationVotes.translationId, translationId),
        ),
      );
  } else {
    await db
      .insert(schema.translationVotes)
      .values({
        userId,
        translationId,
        value: vote,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          schema.translationVotes.userId,
          schema.translationVotes.translationId,
        ],
        set: { value: vote, updatedAt: now },
      });
  }

  return getTranslationVoteSummary(translationId, userId);
}
