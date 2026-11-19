/**
 * Check staff restrictions before ownership, public visibility or sharing. Showing a title in the
 * catalog does not grant access to its contents.
 */
import type { Text, User } from '../db/schema.js';
import { ForbiddenError } from '../dictionary/permissions.js';

export type Viewer = Pick<User, 'id'> | null | undefined;
export type ReadableText = Pick<Text, 'id' | 'ownerId' | 'visibility'> & Partial<Pick<Text, 'staffOnly'>>;

/**
 * Returns true iff the viewer is allowed to read the text under the current policy.
 */
export async function canReadText(
  viewer: Viewer,
  text: ReadableText,
): Promise<boolean> {
  if (text.staffOnly) {
    if (!viewer) return false;
    const { isStaffMember } = await import('./staff.js');
    if (!(await isStaffMember(viewer.id))) return false;
  }
  if (text.visibility === 'official') return true;
  if (viewer && text.ownerId && text.ownerId === viewer.id) return true;
  if (viewer && viewer.id) {
    const { viewerHasDirectShare } = await import('../texts/sharing.js');
    if (await viewerHasDirectShare(viewer.id, text.id)) return true;
    const { viewerHasGroupShare } = await import('../groups.js');
    if (await viewerHasGroupShare(viewer.id, text.id)) return true;
    const { viewerHasCollectionShareForText } = await import(
      '../collections.js'
    );
    if (await viewerHasCollectionShareForText(viewer.id, text.id)) return true;
  }
  return false;
}

/** Authorize before fetching sentence text, including indirect export/mining paths. */
export async function canReadChapter(viewer: Viewer, chapterId: string): Promise<boolean> {
  const { db, schema } = await import('../db/index.js');
  const { eq } = await import('drizzle-orm');
  const [row] = await db.select({ text: schema.texts }).from(schema.textChapters)
    .innerJoin(schema.texts, eq(schema.texts.id, schema.textChapters.textId))
    .where(eq(schema.textChapters.id, chapterId)).limit(1);
  return row ? canReadText(viewer, row.text) : false;
}

export async function canReadAudio(viewer: Viewer, audioId: string): Promise<boolean> {
  const { db, schema } = await import('../db/index.js');
  const { eq } = await import('drizzle-orm');
  const [row] = await db.select({ text: schema.texts }).from(schema.audioFiles)
    .innerJoin(schema.texts, eq(schema.texts.id, schema.audioFiles.textId))
    .where(eq(schema.audioFiles.id, audioId)).limit(1);
  return row ? canReadText(viewer, row.text) : false;
}

export async function assertCanReadText(
  viewer: Viewer,
  text: ReadableText,
): Promise<void> {
  const ok = await canReadText(viewer, text);
  if (!ok) throw new ForbiddenError('You do not have access to this text');
}
