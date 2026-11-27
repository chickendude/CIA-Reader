/**
 * POST /api/v1/auth/verify-email/resend.
 *
 * The verification banner uses this endpoint. Each account can request
 * a verification email once a minute while its daily allowance and the
 * shared unverified allowance have room.
 */
import { error, json } from '@sveltejs/kit';

import { requireUser } from '$lib/server/auth/require-user.js';
import { sendAccountLink } from '$lib/server/email/account-link.js';
import {
  RequestRateLimitError,
  consumeRateLimit,
  rateLimitHeaders,
} from '$lib/server/auth/rate-limits.js';
import type { RequestHandler } from './$types';

const WINDOW_MS = 60_000;
const LIMIT = 1;

export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);

  // Already verified → return 204 so the UI banner can hide itself.
  if (user.emailVerifiedAt) {
    return new Response(null, { status: 204 });
  }

  let limit;
  try {
    limit = await consumeRateLimit(event, user.id, {
      scope: 'auth:verify-email-resend',
      limit: LIMIT,
      windowMs: WINDOW_MS,
    });
  } catch (err) {
    if (err instanceof RequestRateLimitError) {
      return json(
        {
          error: 'rate_limited',
          message: 'Slow down — try again in a minute.',
          retryAfterSeconds: err.retryAfterSeconds,
        },
        { status: 429, headers: rateLimitHeaders(err) },
      );
    }
    throw err;
  }

  try {
    if (await sendAccountLink(user, 'verification') === 'limited') {
      return json({ error: 'daily_email_limit', message: 'Verification emails are paused. Try again later.' }, { status: 429 });
    }
  } catch (err) {
    console.error('Failed to resend verification email:', err);
    throw error(502, 'Could not send verification email. Try again later.');
  }

  return json({ ok: true }, { status: 202, headers: rateLimitHeaders(limit) });
};
