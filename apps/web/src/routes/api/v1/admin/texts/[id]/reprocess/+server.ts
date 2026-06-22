/**
 * POST /api/v1/admin/texts/:id/reprocess (T-4.4 dev affordance,
 * future T-6.8 home).
 *
 * Re-run the NLP pipeline on an existing text — used to recover
 * stuck `pending` texts (e.g. when the dispatcher wasn't registered
 * at upload time) and as the entry point for T-6.8's bulk
 * re-processing after dictionary / override updates.
 *
 * Synchronous (awaits the full process), so the caller can tell
 * whether the run succeeded.
 *
 * Authorization (T-11.3): admin OR text owner. Owners need a retry
 * affordance when their own upload lands in `failed` — gating it
 * behind admin meant a learner whose text bombed had no recourse
 * but to delete + re-upload. Non-owners (even with read access via
 * a share) are still rejected because re-running the pipeline is
 * an active operation, not a read.
 */
import { eq } from 'drizzle-orm';
import { error, json } from '@sveltejs/kit';

import { requireUser } from '$lib/server/auth/require-user.js';
import { db, schema } from '$lib/server/db/index.js';
import { isAdmin } from '$lib/server/dictionary/permissions.js';
import { processTextNow } from '$lib/server/texts/in-process-dispatcher.js';
import { reprocessPdfText } from '$lib/server/texts/pdf-page.js';
import type { Text } from '$lib/server/db/schema.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid text id');

  // Always load the row: needed for the non-admin ownership check and to
  // pick the right reprocess path (PDF vs text).
  const [row] = (await db
    .select()
    .from(schema.texts)
    .where(eq(schema.texts.id, id))
    .limit(1)) as [Text | undefined];
  if (!row) throw error(404, 'Text not found');
  if (!isAdmin({ role: user.role }) && row.ownerId !== user.id) {
    // Flat 404 if owned by someone else, matching the rest of the texts API.
    throw error(404, 'Text not found');
  }

  // PDFs re-tokenize from the stored OCR layout (no Vision spend, boxes
  // preserved); text sources re-run the normal /process pipeline.
  const total =
    row.sourceType === 'pdf'
      ? await reprocessPdfText(id)
      : await processTextNow(id);
  return json({ ok: true, tokensWritten: total });
};
