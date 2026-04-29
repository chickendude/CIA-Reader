/**
 * POST /api/v1/admin/texts/reprocess-batch (T-6.8).
 *
 * Bulk variant of the per-text reprocess endpoint. Walks the
 * library filtered by language + status and dispatches the NLP
 * pipeline against each match. Admin-only. Returns the count +
 * id list immediately — the actual processing runs in the
 * background.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import { isAdmin } from '$lib/server/dictionary/permissions.js';
import { bulkReprocessTexts } from '$lib/server/texts/bulk-reprocess.js';
import { isSupportedLanguage } from '@ciareader/shared-types';
import { parseJson } from '../../../auth/_helpers.js';
import type { LanguageCode } from '@ciareader/shared-types';
import type { RequestHandler } from './$types';

const bodySchema = z
  .object({
    language: z
      .string()
      .refine(isSupportedLanguage, 'unsupported language')
      .optional(),
    statuses: z
      .array(z.enum(['pending', 'processing', 'ready', 'failed']))
      .optional(),
    limit: z.number().int().min(1).max(5000).optional(),
  })
  .strict();

export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  if (!isAdmin({ role: user.role })) throw error(403, 'Admin role required');
  const body = await parseJson(event.request, bodySchema);
  const result = await bulkReprocessTexts({
    language: body.language as LanguageCode | undefined,
    statuses: body.statuses,
    limit: body.limit,
  });
  return json(result, { status: 202 });
};
