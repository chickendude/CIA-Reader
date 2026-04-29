/**
 * POST /api/v1/me/parse-reports (T-6.5 wiring; called by T-6.2's
 * correction modal and T-6.3's new-lemma form).
 *
 * Files (or merges into) a parse_report. The user's optional
 * "Also report to moderators" checkbox in the correction modal
 * decides whether this fires alongside the per-user
 * /api/v1/me/token-corrections write.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import { fileParseReport } from '$lib/server/parse-reports.js';
import { isSupportedLanguage, type LanguageCode } from '@ciareader/shared-types';
import { parseJson } from '../../auth/_helpers.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const candidateSchema = z.object({
  lemmaId: z.string().regex(UUID_RE).nullable(),
  score: z.number(),
  features: z.record(z.string()),
});

const bodySchema = z
  .object({
    tokenId: z.string().regex(UUID_RE).nullable().optional(),
    language: z.string().refine(isSupportedLanguage, 'unsupported language'),
    surfaceNfc: z.string().min(1).max(200),
    contextSignature: z.string().max(64).optional(),
    originalCandidates: z.array(candidateSchema).default([]),
    correctedLemmaId: z.string().regex(UUID_RE).nullable().optional(),
    correctionType: z.enum([
      'pick_candidate',
      'manual_lemma',
      'new_lemma',
      'mark_proper_noun',
      'mark_foreign',
      'mark_not_a_word',
    ]),
    note: z.string().max(2000).nullable().optional(),
  })
  .strict();

export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const body = await parseJson(event.request, bodySchema);

  const { report, merged } = await fileParseReport({
    reporterId: user.id,
    tokenId: body.tokenId ?? null,
    language: body.language as LanguageCode,
    surfaceNfc: body.surfaceNfc,
    contextSignature: body.contextSignature,
    originalCandidates: body.originalCandidates ?? [],
    correctedLemmaId: body.correctedLemmaId ?? null,
    correctionType: body.correctionType,
    note: body.note ?? null,
  });
  return json({ report, merged }, { status: merged ? 200 : 201 });
};

// Block anything other than POST so a bare GET on this URL gets a
// useful 405 instead of SvelteKit's default route-not-found 404.
export const fallback: RequestHandler = async () => {
  throw error(405, 'Method not allowed');
};
