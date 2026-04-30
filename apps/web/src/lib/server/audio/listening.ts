/**
 * Listening stats service (T-10.5).
 *
 * The browser reports small playback deltas; this service validates the
 * audio/text relationship and rolls them into one aggregate row per
 * user/audio file.
 */
import { eq, sql } from 'drizzle-orm';

import { assertCanReadText } from '../auth/can-read.js';
import { db, schema } from '../db/index.js';

const MAX_DELTA_MS = 60_000;

export class ListeningStatsError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404 = 400,
  ) {
    super(message);
    this.name = 'ListeningStatsError';
  }
}

export type RecordListeningInput = {
  userId: string;
  audioFileId: string;
  listenedMs: number;
  now?: Date;
};

export async function recordListeningDelta(
  input: RecordListeningInput,
): Promise<{ audioFileId: string; textId: string; listenedMs: number }> {
  const listenedMs = Math.round(input.listenedMs);
  if (!Number.isFinite(listenedMs) || listenedMs <= 0) {
    throw new ListeningStatsError('listenedMs must be positive');
  }
  if (listenedMs > MAX_DELTA_MS) {
    throw new ListeningStatsError(
      `listenedMs cannot exceed ${MAX_DELTA_MS}`,
    );
  }

  const [row] = await db
    .select({
      audioFileId: schema.audioFiles.id,
      textId: schema.audioFiles.textId,
      ownerId: schema.texts.ownerId,
      visibility: schema.texts.visibility,
    })
    .from(schema.audioFiles)
    .innerJoin(schema.texts, eq(schema.texts.id, schema.audioFiles.textId))
    .where(eq(schema.audioFiles.id, input.audioFileId))
    .limit(1);

  if (!row) {
    throw new ListeningStatsError(
      `Audio file ${input.audioFileId} not found`,
      404,
    );
  }

  try {
    await assertCanReadText(
      { id: input.userId },
      {
        id: row.textId,
        ownerId: row.ownerId,
        visibility: row.visibility,
      },
    );
  } catch {
    throw new ListeningStatsError(
      'You do not have access to this audio',
      403,
    );
  }

  const now = input.now ?? new Date();
  await db
    .insert(schema.userAudioListening)
    .values({
      userId: input.userId,
      audioFileId: row.audioFileId,
      textId: row.textId,
      listenedMs,
      lastListenedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.userAudioListening.userId,
        schema.userAudioListening.audioFileId,
      ],
      set: {
        listenedMs: sql`${schema.userAudioListening.listenedMs} + ${listenedMs}`,
        lastListenedAt: now,
        updatedAt: now,
      },
    });

  return {
    audioFileId: row.audioFileId,
    textId: row.textId,
    listenedMs,
  };
}
