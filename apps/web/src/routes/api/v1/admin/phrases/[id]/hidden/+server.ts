/**
 * PATCH /api/v1/admin/phrases/:id/hidden (T-14.7).
 *
 * Curator moderation flag for phrases. Hidden phrases stay
 * visible to curators / admins (so they can review and unhide)
 * but disappear from anonymous and user views.
 *
 * Body: `{ hidden: boolean, reason: string }`. The `reason` is
 * recorded on the audit row (T-3.4 convention — every curator
 * edit needs a soft "why").
 */
import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  setPhraseHidden,
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
  hidden: z.boolean(),
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
    const updated = await setPhraseHidden({
      phraseId,
      hidden: input.hidden,
      editorId: user.id,
      reason: input.reason,
    });
    return json({ phrase: { id: updated.id, hidden: updated.hidden } });
  } catch (err) {
    if (err instanceof ForbiddenError) throw error(403, err.message);
    if (err instanceof MissingReasonError) throw error(400, err.message);
    if (err instanceof PhraseValidationError) {
      throw error(err.status, err.message);
    }
    throw err;
  }
};
