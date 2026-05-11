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

import { requireVerifiedUser } from '$lib/server/auth/require-user.js';
import {
  RequestRateLimitError,
  consumeRateLimit,
  rateLimitHeaders,
} from '$lib/server/auth/rate-limits.js';
import { parseJson } from '../auth/_helpers.js';
import {
  MAX_BODY_LEN,
  MAX_PER_USER_PER_WINDOW,
  WINDOW_MS,
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
  const user = await requireVerifiedUser(event);
  const input = await parseJson(event.request, body);

  try {
    const requestLimit = await consumeRateLimit(event, user.id, {
      scope: 'translations:create',
      limit: MAX_PER_USER_PER_WINDOW,
      windowMs: WINDOW_MS,
    });
    const translation = await submitUserTranslation(user.id, {
      lemmaId: input.lemmaId,
      body: input.body,
      parentTranslationId: input.parentTranslationId ?? null,
      targetLanguage: input.targetLanguage,
    });
    return json(
      { translation: publicTranslation(translation) },
      { status: 201, headers: rateLimitHeaders(requestLimit) },
    );
  } catch (err) {
    if (err instanceof RequestRateLimitError || err instanceof TranslationRateLimitError) {
      return json(
        {
          error: 'rate_limited',
          message: 'Too many translations submitted. Try again later.',
          limit: err.limit,
          retryAfterSeconds: err.retryAfterSeconds,
        },
        {
          status: 429,
          headers: rateLimitHeaders(
            err instanceof RequestRateLimitError
              ? err
              : {
                  limit: err.limit,
                  remaining: 0,
                  retryAfterSeconds: err.retryAfterSeconds,
                  subjectType: 'user',
                },
          ),
        },
      );
    }
    if (err instanceof TranslationValidationError) {
      throw error(err.status, err.message);
    }
    throw err;
  }
};
