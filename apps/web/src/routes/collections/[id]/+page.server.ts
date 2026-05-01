/**
 * Collection detail page (T-8.2 + T-8.4).
 *
 * Loads the collection + ordered member texts. Visible to:
 *   - Owner (always).
 *   - Admin (always).
 *   - Anyone, when visibility='official'.
 *   - Members of share grants (T-8.4): when the viewer has a row in
 *     `collection_shares` for this collection, they can view the
 *     detail page and read every member text. The reader-side
 *     `canReadText` already grants per-text access via the same
 *     share row (see `viewerHasCollectionShareForText`); this gate
 *     mirrors that policy at the collection level.
 *
 * Aggregated progress is computed in the loader so the UI stays
 * static — the backend has the user's user_text_progress rows for
 * every member text already.
 *
 * When the viewer is the owner we also load the existing share rows
 * so the inline "Manage sharing" form can render without an extra
 * round-trip.
 */
import { error } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';

import {
  listCollectionSharesWithRecipients,
  loadCollectionDetail,
  viewerHasCollectionShare,
} from '$lib/server/collections.js';
import { db, schema } from '$lib/server/db/index.js';
import type { UserTextProgress } from '$lib/server/db/schema.js';
import type { PageServerLoad } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!params.id || !UUID_RE.test(params.id)) {
    throw error(400, 'Invalid collection id');
  }
  const detail = await loadCollectionDetail(params.id);
  if (!detail) throw error(404, 'Collection not found');

  const isOwner = Boolean(
    locals.user && detail.collection.ownerId === locals.user.id,
  );
  const isAdmin = locals.user?.role === 'admin';
  // T-8.4: a non-owner non-admin viewer with a share row passes too.
  // The per-text canReadText gate also honours these rows, so a
  // viewer who lands on the detail page can click into any member
  // text without a second permission denial.
  const hasShare =
    !isOwner &&
    !isAdmin &&
    locals.user != null &&
    detail.collection.visibility !== 'official' &&
    (await viewerHasCollectionShare(locals.user.id, detail.collection.id));

  if (
    detail.collection.visibility !== 'official' &&
    !isOwner &&
    !isAdmin &&
    !hasShare
  ) {
    throw error(404, 'Collection not found');
  }

  // Aggregated progress across member texts for this viewer.
  let aggregatedPctRead = 0;
  let progressByTextId: Record<string, UserTextProgress> = {};
  if (locals.user && detail.items.length > 0) {
    const textIds = detail.items.map((i) => i.text.id);
    const rows = (await db
      .select()
      .from(schema.userTextProgress)
      .where(
        and(
          eq(schema.userTextProgress.userId, locals.user.id),
          inArray(schema.userTextProgress.textId, textIds),
        ),
      )) as UserTextProgress[];
    progressByTextId = Object.fromEntries(rows.map((r) => [r.textId, r]));
    const total = detail.items.length;
    const sum = detail.items.reduce(
      (acc, item) =>
        acc + (progressByTextId[item.text.id]?.pctRead ?? 0),
      0,
    );
    aggregatedPctRead = Math.round(sum / Math.max(1, total));
  }

  return {
    collection: detail.collection,
    items: detail.items.map((i) => ({
      position: i.position,
      text: {
        id: i.text.id,
        title: i.text.title,
        status: i.text.status,
        sourceType: i.text.sourceType,
      },
      pctRead: progressByTextId[i.text.id]?.pctRead ?? 0,
      lastChapterIdx:
        progressByTextId[i.text.id]?.lastChapterIdx ?? 0,
    })),
    aggregatedPctRead,
    // T-8.6: completion stats badge — number of finished texts on
    // course-kind collections. Counts pctRead >= 100.
    completedCount: detail.items.filter(
      (i) => (progressByTextId[i.text.id]?.pctRead ?? 0) >= 100,
    ).length,
    isOwner,
    // T-8.4: existing share grants for the inline manage-sharing
    // form. Loaded only for the owner so non-owners never see who
    // else has access. Each share is decorated with the recipient's
    // email + display name (or null when the user was deleted).
    shares: isOwner
      ? await listCollectionSharesWithRecipients(detail.collection.id, {
          id: locals.user!.id,
          role: locals.user!.role,
        })
      : [],
  };
};
