/**
 * Audio service (T-9.1).
 *
 * Owner-or-admin uploads / deletes; everyone with read access on
 * the parent text can list audio files. Storage is delegated to
 * `getAudioStorage()` so the same code path works against the
 * local-volume dev backend and a future S3-backed prod backend.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import type { AudioFile, Text, User } from '../db/schema.js';
import {
  MAX_AUDIO_BYTES,
  getAudioStorage,
  isAllowedAudioMime,
  newAudioStorageKey,
} from './storage.js';

export class AudioError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404 | 413 | 415 = 400,
  ) {
    super(message);
    this.name = 'AudioError';
  }
}

export type UploadAudioInput = {
  textId: string;
  chapterId?: string | null;
  body: Uint8Array;
  mime: string;
  originalName: string;
  attribution?: string | null;
  license?: string | null;
  durationMs?: number | null;
  uploader: Pick<User, 'id' | 'role'>;
};

export async function uploadAudio(
  input: UploadAudioInput,
): Promise<AudioFile> {
  // Cap body size up-front so a 5GB upload doesn't pin memory
  // before we even check ownership.
  if (input.body.byteLength > MAX_AUDIO_BYTES) {
    throw new AudioError(
      `Audio file too large (max ${(MAX_AUDIO_BYTES / 1024 / 1024).toFixed(0)}MB)`,
      413,
    );
  }
  if (!isAllowedAudioMime(input.mime)) {
    throw new AudioError(`Unsupported audio type ${input.mime}`, 415);
  }

  // Verify the parent text exists and the uploader is the owner /
  // admin. Curators don't get audio rights at this layer — the
  // attribution + licensing checkbox (T-9.7) treats audio as a
  // first-class authoring artifact distinct from the dictionary.
  const [text] = (await db
    .select()
    .from(schema.texts)
    .where(eq(schema.texts.id, input.textId))
    .limit(1)) as Text[];
  if (!text) throw new AudioError('text not found', 404);
  if (input.uploader.role !== 'admin' && text.ownerId !== input.uploader.id) {
    throw new AudioError('only the owner can upload audio', 403);
  }

  if (input.chapterId) {
    const [chapter] = (await db
      .select({ id: schema.textChapters.id, textId: schema.textChapters.textId })
      .from(schema.textChapters)
      .where(eq(schema.textChapters.id, input.chapterId))
      .limit(1)) as Array<{ id: string; textId: string }>;
    if (!chapter) throw new AudioError('chapter not found', 404);
    if (chapter.textId !== input.textId) {
      throw new AudioError('chapter does not belong to this text');
    }
  }

  const id = randomUUID();
  const storageKey = newAudioStorageKey(input.textId, input.originalName, id);
  const storage = getAudioStorage();
  await storage.put(storageKey, input.body, input.mime);

  const [row] = await db
    .insert(schema.audioFiles)
    .values({
      id,
      textId: input.textId,
      chapterId: input.chapterId ?? null,
      storageKey,
      mime: input.mime,
      sizeBytes: input.body.byteLength,
      durationMs: input.durationMs ?? null,
      attribution: input.attribution ?? null,
      license: input.license ?? null,
      uploadedById: input.uploader.id,
    })
    .returning();
  if (!row) throw new AudioError('insert returned no row');
  return row as AudioFile;
}

export type DeleteAudioInput = {
  audioFileId: string;
  actor: Pick<User, 'id' | 'role'>;
};

export async function deleteAudio(input: DeleteAudioInput): Promise<void> {
  const [row] = (await db
    .select({
      id: schema.audioFiles.id,
      storageKey: schema.audioFiles.storageKey,
      ownerId: schema.texts.ownerId,
    })
    .from(schema.audioFiles)
    .innerJoin(
      schema.texts,
      eq(schema.texts.id, schema.audioFiles.textId),
    )
    .where(eq(schema.audioFiles.id, input.audioFileId))
    .limit(1)) as Array<{
    id: string;
    storageKey: string;
    ownerId: string | null;
  }>;
  if (!row) throw new AudioError('audio not found', 404);
  if (
    input.actor.role !== 'admin' &&
    (!row.ownerId || row.ownerId !== input.actor.id)
  ) {
    throw new AudioError('only the owner can delete audio', 403);
  }

  await getAudioStorage().delete(row.storageKey);
  await db
    .delete(schema.audioFiles)
    .where(eq(schema.audioFiles.id, input.audioFileId));
}

export type AudioListItem = {
  id: string;
  textId: string;
  chapterId: string | null;
  mime: string;
  sizeBytes: number;
  durationMs: number | null;
  attribution: string | null;
  license: string | null;
  url: string;
  createdAt: Date;
};

/**
 * List audio attached to a text (or to a specific chapter when
 * chapterId is set). Visibility is delegated to canReadText —
 * we don't list audio for texts the viewer can't access.
 */
export async function listAudioForText(
  textId: string,
  chapterId?: string | null,
): Promise<AudioListItem[]> {
  const conditions = [eq(schema.audioFiles.textId, textId)];
  if (chapterId !== undefined && chapterId !== null) {
    conditions.push(eq(schema.audioFiles.chapterId, chapterId));
  }
  const rows = (await db
    .select()
    .from(schema.audioFiles)
    .where(and(...conditions))) as AudioFile[];
  const storage = getAudioStorage();
  return rows.map((r) => ({
    id: r.id,
    textId: r.textId,
    chapterId: r.chapterId,
    mime: r.mime,
    sizeBytes: r.sizeBytes,
    durationMs: r.durationMs,
    attribution: r.attribution,
    license: r.license,
    url: storage.urlFor(r.storageKey),
    createdAt: r.createdAt,
  }));
}
