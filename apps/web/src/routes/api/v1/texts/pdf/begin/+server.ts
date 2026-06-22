/**
 * POST /api/v1/texts/pdf/begin
 *
 * Opens a PDF import: the browser has read the page count via pdf.js and
 * calls this to create the `texts` row + N empty page chapters, then
 * streams page images to `/api/v1/texts/:id/pages/:idx`. Returns the new
 * text id.
 */
import { error, json } from '@sveltejs/kit';

import { requireVerifiedUser } from '$lib/server/auth/require-user.js';
import {
  consumeRateLimit,
  rateLimitHeaders,
  RequestRateLimitError,
} from '$lib/server/auth/rate-limits.js';
import { createPdfText, TextValidationError } from '$lib/server/texts/upload.js';
import type { RequestHandler } from './$types';

// Per-day cap on PDF imports (the per-page size cap lives in the ingest
// endpoint). Matches the audio upload envelope.
const PDF_UPLOADS_PER_DAY = 20;
const PDF_WINDOW_MS = 24 * 60 * 60 * 1_000;

export const POST: RequestHandler = async (event) => {
  const user = await requireVerifiedUser(event);

  let payload: unknown;
  try {
    payload = await event.request.json();
  } catch {
    throw error(400, 'invalid JSON body');
  }
  const { language, title, pageCount } = (payload ?? {}) as {
    language?: unknown;
    title?: unknown;
    pageCount?: unknown;
  };
  if (typeof language !== 'string') throw error(400, 'language required');
  if (typeof title !== 'string') throw error(400, 'title required');
  if (typeof pageCount !== 'number') throw error(400, 'pageCount required');

  try {
    const requestLimit = await consumeRateLimit(event, user.id, {
      scope: 'pdf:upload',
      limit: PDF_UPLOADS_PER_DAY,
      windowMs: PDF_WINDOW_MS,
    });
    const created = await createPdfText(
      { id: user.id },
      { language, title, pageCount },
    );
    return json(
      { id: created.text.id, pageCount: created.chapters.length },
      { status: 201, headers: rateLimitHeaders(requestLimit) },
    );
  } catch (e) {
    if (e instanceof RequestRateLimitError) {
      return json(
        {
          error: 'rate_limited',
          message: 'Daily PDF upload limit reached. Try again tomorrow.',
          limit: e.limit,
          retryAfterSeconds: e.retryAfterSeconds,
        },
        { status: 429, headers: rateLimitHeaders(e) },
      );
    }
    if (e instanceof TextValidationError) throw error(e.status, e.message);
    throw e;
  }
};
