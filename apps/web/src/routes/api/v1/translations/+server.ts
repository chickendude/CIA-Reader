/**
 * POST /api/v1/translations (T-3.2).
 *
 * Submits a user-authored translation against a lemma. Consumes the same
 * auth surface (session cookie OR bearer access token) as every other
 * v1 endpoint via `requireUser`. Rate-limited per-user against a rolling
 * one-hour window; see `submitUserTranslation` for the exact bounds.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import { parseJson } from '../auth/_helpers.js';
import {
  MAX_BODY_LEN,
  publicTranslation,
  submitUserTranslation,
  TranslationRateLimitError,
  TranslationValidationError,
} from '$lib/server/dictionary/translations.js';
import type { RequestHandler } from './$types';

const body = z.object({
  lemmaId: z.string().uuid(),
  body: z.string().min(1).max(MAX_BODY_LEN),
  // Optional — present for T-3.5's "customize an official" flow.
  parentTranslationId: z.string().uuid().nullish(),
  targetLanguage: z.string().min(2).max(3).optional(),
});

export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const input = await parseJson(event.request, body);

  try {
    const translation = await submitUserTranslation(user.id, {
      lemmaId: input.lemmaId,
      body: input.body,
      parentTranslationId: input.parentTranslationId ?? null,
      targetLanguage: input.targetLanguage,
    });
    return json({ translation: publicTranslation(translation) }, { status: 201 });
  } catch (err) {
    if (err instanceof TranslationRateLimitError) {
      return json(
        {
          error: 'rate_limited',
          message: 'Too many translations submitted. Try again later.',
          limit: err.limit,
          retryAfterSeconds: err.retryAfterSeconds,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(err.retryAfterSeconds),
            'X-RateLimit-Limit': String(err.limit),
            'X-RateLimit-Remaining': '0',
          },
        },
      );
    }
    if (err instanceof TranslationValidationError) {
      throw error(err.status, err.message);
    }
    throw err;
  }
};
