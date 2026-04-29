/**
 * Collection detail page (T-8.2).
 *
 * Loads the collection + ordered member texts. Visible to:
 *   - Owner (always).
 *   - Anyone, when visibility='official'.
 *   - Members of share grants (T-8.4 — no-op for now since the
 *     M7 sharing layer isn't merged into main yet).
 *
 * Aggregated progress is computed in the loader so the UI stays
 * static — the backend has the user's user_text_progress rows for
 * every member text already.
 */
import { error } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';

import { loadCollectionDetail } from '$lib/server/collections.js';
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

  // Visibility gate. Mirrors the policy in T-8.4:
  //   - official: anyone.
  //   - private: owner-only.
  //   - shared: owner + anyone with a share row (M7-dependent).
  const isOwner = Boolean(
    locals.user && detail.collection.ownerId === locals.user.id,
  );
  const isAdmin = locals.user?.role === 'admin';
  if (
    detail.collection.visibility !== 'official' &&
    !isOwner &&
    !isAdmin
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
  };
};
