/**
 * Central read-authorization helper for `texts` (T-4.6).
 *
 * Every reader, stats, and progress endpoint funnels its "may this
 * viewer see this text?" question through here so the policy lives in
 * exactly one place. Deny-by-default — if none of the explicit allow
 * paths match, access is rejected.
 *
 * Staff-only texts require a curator/admin role before any allow path.
 * The catalog can expose metadata without exposing the book's contents.
 * Allow paths:
 *   - **Owner**: `text.owner_id === viewer.id`. The most common case.
 *   - **Official**: `text.visibility === 'official'`. Public; the
 *     viewer may be `null` (anonymous), e.g. SEO crawls of T-7.6.
 *
 * Sharing paths:
 *   - **Direct share**: a row in `text_shares` matching
 *     `(text_id, shared_with_user_id = viewer.id)`.
 *   - **Group share**: the viewer is a member of a group that holds a
 *     `text_group_shares` row for the text.
 *
 * Sharing and staff checks require DB lookups. `canReadText` always returns a
 * boolean; `assertCanReadText` throws a `ForbiddenError` so endpoints
 * can map to 403 / 404 as they prefer (privacy preference: 404 so we
 * don't leak text existence to non-readers).
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
  // 1. Public official texts are readable by anyone, including
  //    anonymous visitors.
  if (text.visibility === 'official') return true;
  // 2. The owner can always read their own text.
  if (viewer && text.ownerId && text.ownerId === viewer.id) return true;
  // 3+. Share-based read access. Each branch is a separate allow
  //     path; the imports stay lazy so unit tests of pure visibility
  //     logic don't need to mock every sharing module.
  if (viewer && viewer.id) {
    // 3. T-7.2: direct shares — row in `text_shares` for this viewer.
    const { viewerHasDirectShare } = await import('../texts/sharing.js');
    if (await viewerHasDirectShare(viewer.id, text.id)) return true;
    // 4. T-7.4: group shares — viewer is a member of a group granted
    //    access to this text.
    const { viewerHasGroupShare } = await import('../groups.js');
    if (await viewerHasGroupShare(viewer.id, text.id)) return true;
    // 5. T-8.4: collection-level shares — the text inherits read
    //    access from any collection-share the viewer holds.
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
