/**
 * POST /api/v1/me/lemma-proposals (T-6.3).
 *
 * Submits a new-lemma proposal from the correction modal. Wraps
 * `submitLemmaProposal` in `lemma-proposals.ts`, which writes the
 * proposal + a per-user `token_corrections` row + an auto-filed
 * `parse_report`.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  LemmaProposalValidationError,
  submitLemmaProposal,
} from '$lib/server/lemma-proposals.js';
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
    tokenId: z.string().regex(UUID_RE),
    language: z.string().refine(isSupportedLanguage, 'unsupported language'),
    headword: z.string().min(1).max(120),
    pos: z.string().min(1).max(40),
    glossDefault: z.string().max(280).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    surfaceNfc: z.string().min(1).max(200),
    contextSignature: z.string().max(64).optional(),
    originalCandidates: z.array(candidateSchema).default([]),
  })
  .strict();

export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const body = await parseJson(event.request, bodySchema);

  try {
    const result = await submitLemmaProposal({
      proposerId: user.id,
      tokenId: body.tokenId,
      language: body.language as LanguageCode,
      headword: body.headword,
      pos: body.pos,
      glossDefault: body.glossDefault ?? null,
      notes: body.notes ?? null,
      surfaceNfc: body.surfaceNfc,
      contextSignature: body.contextSignature,
      originalCandidates: body.originalCandidates ?? [],
    });
    return json(result, { status: 201 });
  } catch (e) {
    if (e instanceof LemmaProposalValidationError) {
      throw error(e.status, e.message);
    }
    throw e;
  }
};
