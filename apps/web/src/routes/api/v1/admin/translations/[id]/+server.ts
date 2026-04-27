/**
 * PATCH /api/v1/admin/translations/:id (T-3.7).
 *
 * Curator-level edit on any translation tied to a lemma they can edit.
 * Supports editing body, target language, attribution, and the
 * one-way promotion of a community translation to curator.
 *
 * Hiding / unhiding a community translation goes through the separate
 * `hidden` sub-route so the intent is explicit in the audit trail.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  CuratorValidationError,
  updateTranslation,
} from '$lib/server/dictionary/curator.js';
import { ForbiddenError } from '$lib/server/dictionary/permissions.js';
import { MissingReasonError } from '$lib/server/dictionary/audit.js';
import type { RequestHandler } from './$types';
import { parseJson } from '../../../auth/_helpers.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const body = z.object({
  body: z.string().optional(),
  targetLanguage: z.string().optional(),
  sourceAttribution: z.string().nullable().optional(),
  promoteToCurator: z.boolean().optional(),
  reason: z.string(),
});

function mapCuratorError(err: unknown): never {
  if (err instanceof CuratorValidationError) throw error(err.status, err.message);
  if (err instanceof ForbiddenError) throw error(403, err.message);
  if (err instanceof MissingReasonError) throw error(400, err.message);
  throw err;
}

export const PATCH: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid translation id');
  const input = await parseJson(event.request, body);
  const { reason, ...patch } = input;
  try {
    const translation = await updateTranslation(user, id, patch, reason);
    return json({ translation });
  } catch (err) {
    mapCuratorError(err);
  }
};
