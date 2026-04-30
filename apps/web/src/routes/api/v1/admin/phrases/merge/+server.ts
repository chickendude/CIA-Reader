/**
 * POST /api/v1/admin/phrases/merge (T-14.7).
 *
 * Curator-side phrase merge. Reassigns translations + spans +
 * status from `dropId` onto `keepId`, deletes the dropped row,
 * writes audit entries on both sides via `lemma_edit_history`
 * with `change_type='phrase_merge'` (the polymorphic phrase_id
 * column added in migration 0030).
 *
 * Permission: curator or admin with edit rights on the phrases'
 * shared language. The service layer performs the
 * keep-vs-drop language match check; this endpoint handles the
 * "you have a curator grant for this language" check via
 * `requireCanEditDictionary` once we know the language.
 */
import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  mergePhrases,
  PhraseMergeMismatchError,
  PhraseValidationError,
} from '$lib/server/phrases.js';
import { MissingReasonError } from '$lib/server/dictionary/audit.js';
import {
  ForbiddenError,
  requireCanEditDictionary,
} from '$lib/server/dictionary/permissions.js';
import { db, schema } from '$lib/server/db/index.js';
import type { LanguageCode } from '@ciareader/shared-types';
import type { RequestHandler } from './$types';
import { parseJson } from '../../../auth/_helpers.js';

const body = z.object({
  keepId: z.string().uuid(),
  dropId: z.string().uuid(),
  reason: z.string().min(3),
});

export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const input = await parseJson(event.request, body);

  // Look up either phrase to find the language for the
  // permission check. The service layer rejects cross-language
  // merges so it's enough to read whichever side resolves first.
  const [keep] = await db
    .select({ language: schema.phrases.language })
    .from(schema.phrases)
    .where(eq(schema.phrases.id, input.keepId))
    .limit(1);
  if (!keep) throw error(404, `Phrase ${input.keepId} not found`);
  try {
    await requireCanEditDictionary(user, keep.language as LanguageCode);
    const result = await mergePhrases({
      keepId: input.keepId,
      dropId: input.dropId,
      performedBy: user.id,
      reason: input.reason,
    });
    return json({
      keptPhrase: { id: result.keptPhrase.id },
      droppedPhraseId: input.dropId,
      moved: result.moved,
    });
  } catch (err) {
    if (err instanceof ForbiddenError) throw error(403, err.message);
    if (err instanceof MissingReasonError) throw error(400, err.message);
    if (err instanceof PhraseMergeMismatchError) throw error(409, err.message);
    if (err instanceof PhraseValidationError) {
      throw error(err.status, err.message);
    }
    throw err;
  }
};
