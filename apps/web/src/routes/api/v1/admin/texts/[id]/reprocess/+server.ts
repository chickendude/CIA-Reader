/**
 * Only the owner or an admin can retry processing a text. A successful response confirms the run
 * finished.
 */
import { eq } from 'drizzle-orm';
import { error, json } from '@sveltejs/kit';

import { requireUser } from '$lib/server/auth/require-user.js';
import { db, schema } from '$lib/server/db/index.js';
import { isAdmin } from '$lib/server/dictionary/permissions.js';
import { countParsedWords } from '$lib/server/texts/jobs.js';
import { processTextNow } from '$lib/server/texts/in-process-dispatcher.js';
import { reprocessPdfText } from '$lib/server/texts/pdf-page.js';
import type { Text } from '$lib/server/db/schema.js';
import type { ReprocessUpdate } from '$lib/text/reprocess.js';
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
  const run = row.sourceType === 'pdf' ? reprocessPdfText : processTextNow;
  if (event.request.headers.get('accept') !== 'application/x-ndjson') {
    return json({ ok: true, tokensWritten: await run(id) });
  }

  const encoder = new TextEncoder();
  let connected = true;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(update: ReprocessUpdate) {
        if (connected) controller.enqueue(encoder.encode(JSON.stringify(update) + '\n'));
      }
      try {
        const tokensWritten = await run(id, (completed, total) => {
          send({ type: 'progress', completed, total });
        });
        send({ type: 'complete', tokensWritten, wordsParsed: await countParsedWords(id) });
      } catch (err) {
        console.error(`Reprocessing text ${id} failed`, err);
        send({ type: 'error', message: 'Book reprocessing failed.' });
      } finally {
        if (connected) controller.close();
      }
    },
    cancel() {
      connected = false;
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store, no-transform' },
  });
};
