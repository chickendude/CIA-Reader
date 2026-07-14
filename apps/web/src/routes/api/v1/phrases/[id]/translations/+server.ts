/**
 * POST /api/v1/phrases/:id/translations (T-14.1).
 *
 * Submits a user-authored translation against a phrase. Mirrors
 * `POST /api/v1/translations` (T-3.2) which targets lemmas — the
 * service surface is `submitUserPhraseTranslation`. Like the lemma
 * path, this is not rate-limited: it's the reader's own annotation
 * loop, and shared-dictionary abuse is handled by moderation.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import { parseJson } from '../../../auth/_helpers.js';
import {
  MAX_BODY_LEN,
  publicTranslation,
  submitUserPhraseTranslation,
  TranslationValidationError,
} from '$lib/server/dictionary/translations.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const body = z.object({
  body: z.string().min(1).max(MAX_BODY_LEN),
  // T-3.5 customize fork applies to phrase translations too — a
  // user can fork a curator phrase translation into their own
  // edit; the parent stays in everyone else's view.
  parentTranslationId: z.string().uuid().nullish(),
  targetLanguage: z.string().min(2).max(3).optional(),
  isPrivate: z.boolean().optional(),
});

export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const phraseId = event.params.id;
  if (!phraseId || !UUID_RE.test(phraseId)) {
    throw error(400, 'Invalid phrase id');
  }
  const input = await parseJson(event.request, body);

  try {
    const translation = await submitUserPhraseTranslation(user.id, {
      phraseId,
      body: input.body,
      parentTranslationId: input.parentTranslationId ?? null,
      targetLanguage: input.targetLanguage,
      isPrivate: input.isPrivate ?? false,
    });
    return json({ translation: publicTranslation(translation) }, { status: 201 });
  } catch (err) {
    if (err instanceof TranslationValidationError) {
      throw error(err.status, err.message);
    }
    throw err;
  }
};
