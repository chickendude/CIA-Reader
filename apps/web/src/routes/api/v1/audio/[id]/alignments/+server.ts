/**
 * GET + PUT /api/v1/audio/:id/alignments (T-9.3 / T-9.5 / T-9.6).
 *
 * GET is read-only — the player fetches the timeline once on
 * mount, then runs binary search per timeupdate.
 *
 * PUT replaces the whole set; owner-or-admin only. T-9.5's editor
 * + T-9.6's importer both write through this surface.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  AlignmentError,
  listAlignments,
  replaceAlignments,
} from '$lib/server/audio/alignments.js';
import { parseJson } from '../../../auth/_helpers.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const putSchema = z
  .object({
    source: z.enum(['manual', 'imported', 'whisper']).default('manual'),
    alignments: z
      .array(
        z.object({
          tokenId: z.string().regex(UUID_RE),
          startMs: z.number().int().min(0),
          endMs: z.number().int().min(0),
        }),
      )
      .max(50_000),
  })
  .strict();

export const GET: RequestHandler = async (event) => {
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid audio id');
  const alignments = await listAlignments(id);
  return json({ alignments });
};

export const PUT: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid audio id');
  const body = await parseJson(event.request, putSchema);
  try {
    const written = await replaceAlignments({
      audioFileId: id,
      alignments: body.alignments,
      source: body.source ?? 'manual',
      actor: { id: user.id, role: user.role },
    });
    return json({ ok: true, written });
  } catch (e) {
    if (e instanceof AlignmentError) throw error(e.status, e.message);
    throw e;
  }
};
