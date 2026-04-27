/**
 * Login page (T-1.1 — UI side, deferred from initial M1).
 *
 * Two form actions on this page: `default` (email + password) and
 * `magic` (passwordless email link). Both share the same loader,
 * which honors a `?next=` redirect target so private routes can
 * round-trip through here without losing the user's intent.
 *
 * Authentication itself runs through the same service helpers the
 * /api/v1/auth/login endpoint uses — Lucia-style sessions for the
 * web cookie. Mobile clients keep using the JSON endpoint and its
 * bearer-token response shape.
 */
import { eq } from 'drizzle-orm';
import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';

import { db, schema } from '$lib/server/db/index.js';
import { verifyPassword } from '$lib/server/auth/password.js';
import { createSession, setSessionCookie } from '$lib/server/auth/sessions.js';
import { createMagicLink } from '$lib/server/auth/magic-link.js';
import { buildMagicLinkEmail, sendMail } from '$lib/server/email/index.js';
import { APP_BASE_URL } from '$lib/server/env.js';
import { emailSchema, isSecureRequest } from '../api/v1/auth/_helpers.js';
import type { Actions, PageServerLoad } from './$types';

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
});

const magicSchema = z.object({
  email: emailSchema,
});

/** Where to send the user after a successful login. Defaults to the
 * library tab — that's the most likely first stop. We only honor
 * same-origin paths to avoid open-redirect abuse. */
function readNext(url: URL): string {
  const raw = url.searchParams.get('next');
  if (!raw) return '/library';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/library';
  return raw;
}

export const load: PageServerLoad = ({ locals, url }) => {
  if (locals.user) {
    throw redirect(303, readNext(url));
  }
  return { next: readNext(url) };
};

export const actions: Actions = {
  default: async ({ request, cookies, url }) => {
    const fd = await request.formData();
    const raw = {
      email: fd.get('email')?.toString() ?? '',
      password: fd.get('password')?.toString() ?? '',
    };
    const parsed = loginSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(400, {
        ok: false,
        message: parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
        values: { email: raw.email },
      });
    }

    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, parsed.data.email))
      .limit(1);
    const invalid = () =>
      fail(401, {
        ok: false,
        message: 'Invalid email or password',
        values: { email: raw.email },
      });
    if (!user || !user.passwordHash) return invalid();
    const passwordOk = await verifyPassword(user.passwordHash, parsed.data.password);
    if (!passwordOk) return invalid();

    const session = await createSession(user.id);
    setSessionCookie(cookies, session.token, session.expiresAt, isSecureRequest(url));

    throw redirect(303, readNext(url));
  },

  magic: async ({ request }) => {
    const fd = await request.formData();
    const raw = { email: fd.get('email')?.toString() ?? '' };
    const parsed = magicSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(400, {
        ok: false,
        section: 'magic',
        message: 'Enter a valid email',
        values: { email: raw.email },
      });
    }

    const [user] = await db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.email, parsed.data.email))
      .limit(1);

    // Always reply with the same success message so we don't leak
    // which emails are registered. The send fires only when there's
    // a match.
    if (user) {
      try {
        const token = await createMagicLink(user.id);
        const link = `${APP_BASE_URL}/auth/magic/${encodeURIComponent(token)}`;
        await sendMail(buildMagicLinkEmail(user.email, link));
      } catch (err) {
        console.error('Failed to send magic link:', err);
      }
    }

    // `next` rides on the URL when the user clicks the link — but
    // the link itself goes through /auth/magic/[token] which already
    // handles the post-login redirect, so we don't need to thread it
    // through here.

    return {
      ok: true,
      section: 'magic',
      message: `If an account exists for ${parsed.data.email}, a sign-in link is on its way.`,
    };
  },
};
