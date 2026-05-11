/**
 * POST /api/v1/auth/verify-email/resend (T-11.7).
 *
 * Sends a fresh magic-link email to the authenticated user so they
 * can verify their address. Used by the verification banner's
 * "Resend it" CTA. Idempotent on already-verified users (204) so
 * the UI doesn't have to special-case its own success state.
 *
 * Rate-limited per user — 1 send / 60s — to keep an obviously
 * legitimate user (who lost the original email) flowing without
 * letting a runaway client spam our SMTP relay.
 */
import { error, json } from '@sveltejs/kit';

import { requireUser } from '$lib/server/auth/require-user.js';
import { createMagicLink } from '$lib/server/auth/magic-link.js';
import {
  RequestRateLimitError,
  consumeRateLimit,
  rateLimitHeaders,
} from '$lib/server/auth/rate-limits.js';
import { buildMagicLinkEmail, sendMail } from '$lib/server/email/index.js';
import { APP_BASE_URL } from '$lib/server/env.js';
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

  const token = await createMagicLink(user.id);
  const verifyUrl = `${APP_BASE_URL}/auth/magic/${encodeURIComponent(token)}`;
  try {
    await sendMail(buildMagicLinkEmail(user.email, verifyUrl));
  } catch (err) {
    console.error('Failed to resend verification email:', err);
    throw error(502, 'Could not send verification email. Try again later.');
  }

  return json({ ok: true }, { status: 202, headers: rateLimitHeaders(limit) });
};
