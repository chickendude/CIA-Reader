/**
 * POST /api/v1/admin/parse-reports/:id/accept (T-6.6).
 *
 * Promotes the report's chosen lemma into form_lemma_overrides
 * (worker + reader fallback consume that for everyone) and
 * resolves the report.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  ParseReportValidationError,
  acceptParseReport,
} from '$lib/server/parse-reports.js';
import { parseJson } from '../../../../auth/_helpers.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bodySchema = z
  .object({
    resolutionNote: z.string().max(2000).nullable().optional(),
  })
  .strict();

export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  if (user.role !== 'curator' && user.role !== 'admin') {
    throw error(403, 'Curator or admin required');
  }
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid report id');
  const body = await parseJson(event.request, bodySchema);
  try {
    const result = await acceptParseReport({
      reportId: id,
      reviewerId: user.id,
      resolutionNote: body.resolutionNote ?? null,
    });
    return json(result);
  } catch (e) {
    if (e instanceof ParseReportValidationError) throw error(e.status, e.message);
    throw e;
  }
};
