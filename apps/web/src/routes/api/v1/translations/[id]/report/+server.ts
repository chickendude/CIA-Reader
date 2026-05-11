/**
 * POST /api/v1/translations/:id/report (T-11.1).
 *
 * Files a moderation report against a community translation. The reader
 * pop-up's "Report" button is the only client. Auth is required so we have
 * a `reporterId` for rate limiting + dedup; the unique
 * `(reporter_id, translation_id)` constraint surfaces as 409.
 *
 * Status code map mirrors the existing `POST /api/v1/translations` route
 * (rate-limit 429 with `Retry-After`, validation 400, etc.) so the popup
 * can use the same error-handling shape it already has for translation
 * submissions.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireVerifiedUser } from '$lib/server/auth/require-user.js';
import {
  MAX_NOTE_LEN,
  publicReport,
  ReportDuplicateError,
  ReportRateLimitError,
  ReportValidationError,
  submitReport,
} from '$lib/server/moderation/reports.js';
import { parseJson } from '../../../auth/_helpers.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const body = z.object({
  reason: z.enum(['spam', 'incorrect', 'offensive', 'duplicate', 'other']),
  note: z.string().max(MAX_NOTE_LEN).nullish(),
});

export const POST: RequestHandler = async (event) => {
  const user = await requireVerifiedUser(event);
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid translation id');
  const input = await parseJson(event.request, body);

  try {
    const report = await submitReport(user, id, {
      reason: input.reason,
      note: input.note ?? null,
    });
    return json({ report: publicReport(report) }, { status: 201 });
  } catch (err) {
    if (err instanceof ReportRateLimitError) {
      return json(
        {
          error: 'rate_limited',
          message: 'Too many reports submitted. Try again later.',
          limit: err.limit,
          retryAfterSeconds: err.retryAfterSeconds,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(err.retryAfterSeconds),
            'X-RateLimit-Limit': String(err.limit),
            'X-RateLimit-Remaining': '0',
          },
        },
      );
    }
    if (err instanceof ReportDuplicateError) {
      throw error(409, err.message);
    }
    if (err instanceof ReportValidationError) {
      throw error(err.status, err.message);
    }
    throw err;
  }
};
