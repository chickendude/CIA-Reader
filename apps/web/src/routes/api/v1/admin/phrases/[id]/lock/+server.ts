/**
 * PATCH /api/v1/admin/phrases/:id/lock (T-14.7).
 *
 * Toggle the curator-locked flag on a phrase. Locked phrases are
 * skipped by the import / NLP-promotion paths so a human-curated
 * gloss / frequency / source survives subsequent re-imports.
 * Mirror of the lemma-side lock from T-3.7.
 */
import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  setPhraseLocked,
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
import { parseJson } from '../../../../auth/_helpers.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const body = z.object({
  locked: z.boolean(),
  reason: z.string().min(3),
});

export const PATCH: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const phraseId = event.params.id;
  if (!phraseId || !UUID_RE.test(phraseId)) {
    throw error(400, 'Invalid phrase id');
  }
  const input = await parseJson(event.request, body);

  const [phrase] = await db
    .select({ language: schema.phrases.language })
    .from(schema.phrases)
    .where(eq(schema.phrases.id, phraseId))
    .limit(1);
  if (!phrase) throw error(404, 'Phrase not found');

  try {
    await requireCanEditDictionary(user, phrase.language as LanguageCode);
    const updated = await setPhraseLocked({
      phraseId,
      locked: input.locked,
      editorId: user.id,
      reason: input.reason,
    });
    return json({
      phrase: { id: updated.id, curatorLocked: updated.curatorLocked },
    });
  } catch (err) {
    if (err instanceof ForbiddenError) throw error(403, err.message);
    if (err instanceof MissingReasonError) throw error(400, err.message);
    if (err instanceof PhraseValidationError) {
      throw error(err.status, err.message);
    }
    throw err;
  }
};
