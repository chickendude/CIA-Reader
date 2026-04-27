/**
 * POST /api/v1/admin/lemmas/:id/split (T-3.7).
 *
 * Creates a new curator-sourced lemma off an existing one and moves the
 * selected translations + forms onto it. `:id` is the source lemma.
 *
 * Intended for homograph disambiguation — e.g. Hindi "सोना" was
 * imported as one entry but actually conflates noun "gold" and verb
 * "to sleep"; split the translations that describe "gold" onto a new
 * noun lemma.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  CuratorValidationError,
  splitLemma,
} from '$lib/server/dictionary/curator.js';
import { ForbiddenError } from '$lib/server/dictionary/permissions.js';
import { MissingReasonError } from '$lib/server/dictionary/audit.js';
import type { RequestHandler } from './$types';
import { parseJson } from '../../../../auth/_helpers.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const body = z.object({
  newLemma: z.object({
    headword: z.string(),
    pos: z.string(),
    script: z.string().optional(),
    glossDefault: z.string().nullable().optional(),
    frequencyRank: z.number().int().nullable().optional(),
    sourceAttribution: z.string().nullable().optional(),
  }),
  translationIds: z.array(z.string()).optional(),
  formIds: z.array(z.string()).optional(),
  reason: z.string(),
});

function mapCuratorError(err: unknown): never {
  if (err instanceof CuratorValidationError) throw error(err.status, err.message);
  if (err instanceof ForbiddenError) throw error(403, err.message);
  if (err instanceof MissingReasonError) throw error(400, err.message);
  throw err;
}

export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const sourceId = event.params.id;
  if (!sourceId || !UUID_RE.test(sourceId)) throw error(400, 'Invalid lemma id');
  const input = await parseJson(event.request, body);
  try {
    const result = await splitLemma(
      user,
      {
        fromLemmaId: sourceId,
        newLemma: input.newLemma,
        translationIds: input.translationIds,
        formIds: input.formIds,
      },
      input.reason,
    );
    return json({
      created: result.created,
      translationsMoved: result.translationsMoved,
      formsMoved: result.formsMoved,
    });
  } catch (err) {
    mapCuratorError(err);
  }
};
