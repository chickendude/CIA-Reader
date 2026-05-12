/**
 * POST /api/v1/collections/:id/reprocess
 *
 * Re-dispatch the NLP pipeline against member texts. Owner or admin
 * only — matches the rest of the collection management surface.
 *
 * Body (optional):
 *   { "all": true }  → reprocess every member text regardless of
 *                       status. Useful after a dictionary import
 *                       when the chapters are already 'ready' but
 *                       would benefit from a fresh tokenization.
 *   omitted / false  → only reprocess texts currently `pending` or
 *                       `failed` (the typical "unstick" case).
 *
 * Fire-and-forget per text. Returns the count + ids dispatched so
 * the caller can surface "dispatched N chapters" without waiting for
 * the actual work to finish; the polling status badge tracks each
 * text from there.
 */
import { and, inArray } from 'drizzle-orm';
import { error, json } from '@sveltejs/kit';

import { requireUser } from '$lib/server/auth/require-user.js';
import { isAdmin } from '$lib/server/dictionary/permissions.js';
import { db, schema } from '$lib/server/db/index.js';
import { loadCollectionDetail } from '$lib/server/collections.js';
import { processTextNow } from '$lib/server/texts/in-process-dispatcher.js';
import type { Text } from '$lib/server/db/schema.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STUCK_STATUSES: Array<Text['status']> = ['pending', 'failed'];

export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid collection id');

  // Optional body. We don't reject a missing/empty body — the common
  // case (rescue pending/failed chapters) doesn't need any payload.
  let all = false;
  try {
    const text = await event.request.text();
    if (text.trim().length > 0) {
      const parsed = JSON.parse(text) as { all?: unknown };
      all = parsed.all === true;
    }
  } catch {
    throw error(400, 'Invalid JSON body');
  }

  const detail = await loadCollectionDetail(id);
  if (!detail) throw error(404, 'Collection not found');

  const isOwner = detail.collection.ownerId === user.id;
  if (!isOwner && !isAdmin({ role: user.role })) {
    throw error(404, 'Collection not found');
  }

  if (detail.items.length === 0) {
    return json({ matched: 0, dispatched: 0, textIds: [] });
  }

  // Re-query the live status rather than trusting
  // `detail.items[].text.status` — there's a window between the page
  // load and this POST where the worker could have flipped a row.
  const memberIds = detail.items.map((i) => i.text.id);
  const conditions = [inArray(schema.texts.id, memberIds)];
  if (!all) conditions.push(inArray(schema.texts.status, STUCK_STATUSES));
  const rows = (await db
    .select({ id: schema.texts.id })
    .from(schema.texts)
    .where(and(...conditions))) as Array<{ id: string }>;

  const textIds = rows.map((r) => r.id);
  // Fire-and-forget per text — same pattern as bulkReprocessTexts.
  // The dispatcher writes status flips back to the texts row, which
  // the polling endpoint surfaces to the UI.
  for (const tid of textIds) {
    void processTextNow(tid).catch((err) => {
      console.error(
        `collection ${id} reprocess: text ${tid} failed:`,
        err,
      );
    });
  }

  return json({ matched: textIds.length, dispatched: textIds.length, textIds });
};
