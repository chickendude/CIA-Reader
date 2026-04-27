/**
 * POST /api/v1/admin/translations/bulk-import (T-3.9).
 *
 * Admin-only. Accepts an array of curator-written gloss rows, each
 * resolving an existing lemma by `(language, headword, pos)`. Rows that
 * cannot be resolved are returned in `skipped` so the caller can fix
 * the upload — we never auto-create lemmas here (use the dictionary
 * editor / proposal queue for that).
 *
 * Response shape:
 *   { inserted: number, skipped: Array<{ row: number, reason: string }> }
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  bulkImportTranslations,
  BULK_LIMIT,
} from '$lib/server/dictionary/bulk.js';
import { CuratorValidationError } from '$lib/server/dictionary/curator.js';
import { ForbiddenError } from '$lib/server/dictionary/permissions.js';
import { MissingReasonError } from '$lib/server/dictionary/audit.js';
import type { RequestHandler } from './$types';
import { parseJson } from '../../../auth/_helpers.js';

const rowSchema = z.object({
  language: z.string().min(2).max(8),
  headword: z.string().min(1).max(128),
  pos: z.string().min(1).max(32),
  body: z.string().min(1).max(500),
  targetLanguage: z.string().min(2).max(8).optional(),
  sourceAttribution: z.string().max(500).nullable().optional(),
});

const body = z.object({
  rows: z.array(rowSchema).min(1).max(BULK_LIMIT),
  reason: z.string().min(3).max(500),
  defaults: z
    .object({
      sourceAttribution: z.string().max(500).nullable().optional(),
    })
    .optional(),
});

function mapErr(err: unknown): never {
  if (err instanceof CuratorValidationError) throw error(err.status, err.message);
  if (err instanceof ForbiddenError) throw error(403, err.message);
  if (err instanceof MissingReasonError) throw error(400, err.message);
  throw err;
}

export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const input = await parseJson(event.request, body);
  try {
    const result = await bulkImportTranslations(
      user,
      input.rows,
      input.reason,
      input.defaults ?? {},
    );
    return json(result);
  } catch (err) {
    mapErr(err);
  }
};
