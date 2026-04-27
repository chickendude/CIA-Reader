/**
 * GET + PATCH /api/v1/admin/lemmas/:id (T-3.7).
 *
 * Backs the curator dictionary editor. GET returns the full editor
 * view (lemma + translations + forms + recent history). PATCH updates
 * editable fields on the lemma and implicitly marks it `curatorLocked`
 * so future imports won't clobber the edit.
 *
 * Permission: requireCanEditDictionary inside the service — admins
 * always pass, curators need a `curator_languages` grant for the
 * lemma's language. Anonymous callers get 401 via requireUser.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  CuratorValidationError,
  getLemmaEditorView,
  updateLemma,
} from '$lib/server/dictionary/curator.js';
import { ForbiddenError } from '$lib/server/dictionary/permissions.js';
import { MissingReasonError } from '$lib/server/dictionary/audit.js';
import type { RequestHandler } from './$types';
import { parseJson } from '../../../auth/_helpers.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const patchBody = z.object({
  headword: z.string().optional(),
  pos: z.string().optional(),
  script: z.string().optional(),
  glossDefault: z.string().nullable().optional(),
  frequencyRank: z.number().int().nullable().optional(),
  sourceAttribution: z.string().nullable().optional(),
  reason: z.string(),
});

function mapCuratorError(err: unknown): never {
  if (err instanceof CuratorValidationError) throw error(err.status, err.message);
  if (err instanceof ForbiddenError) throw error(403, err.message);
  if (err instanceof MissingReasonError) throw error(400, err.message);
  throw err;
}

export const GET: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid lemma id');
  try {
    const view = await getLemmaEditorView(user, id);
    return json(view);
  } catch (err) {
    mapCuratorError(err);
  }
};

export const PATCH: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid lemma id');
  const input = await parseJson(event.request, patchBody);
  const { reason, ...patch } = input;
  try {
    const lemma = await updateLemma(user, id, patch, reason);
    return json({ lemma });
  } catch (err) {
    mapCuratorError(err);
  }
};
