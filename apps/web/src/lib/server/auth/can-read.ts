/**
 * Central read-authorization helper for `texts` (T-4.6).
 *
 * Every reader, stats, and progress endpoint funnels its "may this
 * viewer see this text?" question through here so the policy lives in
 * exactly one place. Deny-by-default — if none of the explicit allow
 * paths match, access is rejected.
 *
 * Allow paths today:
 *   - **Owner**: `text.owner_id === viewer.id`. The most common case.
 *   - **Official**: `text.visibility === 'official'`. Public; the
 *     viewer may be `null` (anonymous), e.g. SEO crawls of T-7.6.
 *
 * Allow paths the plan calls for that aren't wired yet (M7):
 *   - **Direct share**: a row in `text_shares` matching
 *     `(text_id, shared_with_user_id = viewer.id)`.
 *   - **Group share**: the viewer is a member of a group that holds a
 *     `text_group_shares` row for the text.
 *
 * Both M7 paths require a DB lookup, so the helper is async even
 * though today's logic is purely in-memory. M7 plugs in the lookups
 * without touching any call site. `canReadText` always returns a
 * boolean; `assertCanReadText` throws a `ForbiddenError` so endpoints
 * can map to 403 / 404 as they prefer (privacy preference: 404 so we
 * don't leak text existence to non-readers).
 */
import type { Text, User } from '../db/schema.js';
import { ForbiddenError } from '../dictionary/permissions.js';

export type Viewer = Pick<User, 'id'> | null | undefined;
export type ReadableText = Pick<Text, 'id' | 'ownerId' | 'visibility'>;

/**
 * Pure predicate. Returns true iff the viewer is allowed to read the
 * text under the current policy. Async because M7 will need DB
 * lookups for the share-table branches; today nothing here awaits.
 */
export async function canReadText(
  viewer: Viewer,
  text: ReadableText,
): Promise<boolean> {
  // 1. Public official texts are readable by anyone, including
  //    anonymous visitors.
  if (text.visibility === 'official') return true;
  // 2. The owner can always read their own text.
  if (viewer && text.ownerId && text.ownerId === viewer.id) return true;
  // 3. T-7.2: direct shares. A row in `text_shares` keyed on
  //    (text_id, viewer.id) grants read access regardless of the
  //    text's visibility. Imported lazily so unit tests of pure
  //    visibility logic don't need to mock the sharing module.
  if (viewer && viewer.id) {
    const { viewerHasDirectShare } = await import('../texts/sharing.js');
    if (await viewerHasDirectShare(viewer.id, text.id)) return true;
  }
  // 4. Group shares (T-7.4) plug in here.
  return false;
}

export async function assertCanReadText(
  viewer: Viewer,
  text: ReadableText,
): Promise<void> {
  const ok = await canReadText(viewer, text);
  if (!ok) throw new ForbiddenError('You do not have access to this text');
}
