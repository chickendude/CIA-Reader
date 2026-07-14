/**
 * POST /api/v1/translations (T-3.2).
 *
 * Submits a user-authored translation against a lemma. Consumes the same
 * auth surface (session cookie OR bearer access token) as every other
 * v1 endpoint via `requireUser`. Not rate-limited — saving definitions is
 * the reader's core annotation loop; shared-dictionary abuse is handled
 * by moderation and the (separately capped) report flow instead.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireVerifiedUser } from '$lib/server/auth/require-user.js';
import { parseJson } from '../auth/_helpers.js';
import {
  MAX_BODY_LEN,
  publicTranslation,
  submitUserTranslation,
  TranslationValidationError,
} from '$lib/server/dictionary/translations.js';
import type { RequestHandler } from './$types';

const body = z.object({
  lemmaId: z.string().uuid(),
  body: z.string().min(1).max(MAX_BODY_LEN),
  // Optional — present for T-3.5's "customize an official" flow.
  parentTranslationId: z.string().uuid().nullish(),
  targetLanguage: z.string().min(2).max(3).optional(),
  // A private note is visible only to its author.
  isPrivate: z.boolean().optional(),
});

export const POST: RequestHandler = async (event) => {
  const user = await requireVerifiedUser(event);
  const input = await parseJson(event.request, body);

  try {
    const translation = await submitUserTranslation(user.id, {
      lemmaId: input.lemmaId,
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
