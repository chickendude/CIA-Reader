/**
 * POST /api/v1/admin/parse-reports/:id/resolve (T-6.6).
 *
 * Updates the report's status to one of resolved / rejected /
 * duplicate / deferred / triaged. Reject + resolve + duplicate
 * require a non-empty resolution note.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  ParseReportValidationError,
  resolveParseReport,
} from '$lib/server/parse-reports.js';
import { parseJson } from '../../../../auth/_helpers.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bodySchema = z
  .object({
    status: z.enum([
      'resolved',
      'rejected',
      'duplicate',
      'deferred',
      'triaged',
      'open',
    ]),
    resolutionNote: z.string().max(2000).nullable().optional(),
    duplicateOfReportId: z.string().regex(UUID_RE).nullable().optional(),
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
    const report = await resolveParseReport({
      reportId: id,
      reviewerId: user.id,
      status: body.status,
      resolutionNote: body.resolutionNote ?? null,
      duplicateOfReportId: body.duplicateOfReportId ?? null,
    });
    return json({ report });
  } catch (e) {
    if (e instanceof ParseReportValidationError) throw error(e.status, e.message);
    throw e;
  }
};
