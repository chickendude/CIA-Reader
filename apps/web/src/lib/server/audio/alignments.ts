/**
 * Alignments service (T-9.3 / T-9.5 / T-9.6).
 *
 * Owners + admins write alignments; everyone with read access on
 * the parent text can list them.
 */
import { asc, eq, inArray } from 'drizzle-orm';

import type { AlignmentListItem } from '../../audio/alignments.js';
import { db, schema } from '../db/index.js';
import type { AudioAlignment, User } from '../db/schema.js';
export { findAlignmentAt } from '../../audio/alignments.js';
export type { AlignmentListItem } from '../../audio/alignments.js';

export class AlignmentError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404 = 400,
  ) {
    super(message);
    this.name = 'AlignmentError';
  }
}

export async function listAlignments(
  audioFileId: string,
): Promise<AlignmentListItem[]> {
  const rows = (await db
    .select()
    .from(schema.audioAlignments)
    .where(eq(schema.audioAlignments.audioFileId, audioFileId))
    .orderBy(asc(schema.audioAlignments.startMs))) as AudioAlignment[];
  return rows.map((r) => ({
    tokenId: r.tokenId,
    startMs: r.startMs,
    endMs: r.endMs,
  }));
}

export type WriteAlignmentInput = {
  audioFileId: string;
  alignments: Array<{ tokenId: string; startMs: number; endMs: number }>;
  source: 'manual' | 'imported' | 'whisper';
  actor: Pick<User, 'id' | 'role'>;
};

/**
 * Replace every alignment for `audioFileId`. The editor / importer
 * sends the full set; we delete + insert in one transaction so a
 * partially-written set doesn't leave the audio half-aligned.
 *
 * Owner-or-admin only.
 */
export async function replaceAlignments(
  input: WriteAlignmentInput,
): Promise<number> {
  const [audio] = (await db
    .select({
      audioId: schema.audioFiles.id,
      ownerId: schema.texts.ownerId,
    })
    .from(schema.audioFiles)
    .innerJoin(
      schema.texts,
      eq(schema.texts.id, schema.audioFiles.textId),
    )
    .where(eq(schema.audioFiles.id, input.audioFileId))
    .limit(1)) as Array<{ audioId: string; ownerId: string | null }>;
  if (!audio) throw new AlignmentError('audio not found', 404);
  if (
    input.actor.role !== 'admin' &&
    (!audio.ownerId || audio.ownerId !== input.actor.id)
  ) {
    throw new AlignmentError('only the owner can edit alignments', 403);
  }

  // Validate every alignment row references a real text_token.
  const tokenIds = Array.from(new Set(input.alignments.map((a) => a.tokenId)));
  if (tokenIds.length > 0) {
    const present = (await db
      .select({ id: schema.textTokens.id })
      .from(schema.textTokens)
      .where(inArray(schema.textTokens.id, tokenIds))) as Array<{ id: string }>;
    if (present.length !== tokenIds.length) {
      throw new AlignmentError('one or more tokenIds are missing');
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(schema.audioAlignments)
      .where(eq(schema.audioAlignments.audioFileId, input.audioFileId));
    if (input.alignments.length > 0) {
      await tx.insert(schema.audioAlignments).values(
        input.alignments.map((a) => ({
          audioFileId: input.audioFileId,
          tokenId: a.tokenId,
          startMs: a.startMs,
          endMs: a.endMs,
          source: input.source,
        })),
      );
    }
  });
  return input.alignments.length;
}
