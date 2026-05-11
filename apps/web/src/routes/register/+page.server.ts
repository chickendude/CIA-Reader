/**
 * Register page — counterpart to /login.
 *
 * Email + password (+ optional display name). Same auth machinery as
 * the JSON /api/v1/auth/register endpoint: hash, insert, drop a
 * session cookie, redirect to /onboarding (the per-language picker)
 * unless the user came in with an explicit `?next=` target.
 */
import { eq } from 'drizzle-orm';
import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';

import { db, schema } from '$lib/server/db/index.js';
import { hashPassword } from '$lib/server/auth/password.js';
import { createMagicLink } from '$lib/server/auth/magic-link.js';
import { createSession, setSessionCookie } from '$lib/server/auth/sessions.js';
import { buildMagicLinkEmail, sendMail } from '$lib/server/email/index.js';
import { APP_BASE_URL } from '$lib/server/env.js';
import {
  emailSchema,
  isSecureRequest,
  passwordSchema,
} from '../api/v1/auth/_helpers.js';
import type { Actions, PageServerLoad } from './$types';

const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().max(80).optional(),
});

function readNext(url: URL): string {
  const raw = url.searchParams.get('next');
  if (!raw) return '/onboarding';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/onboarding';
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
      displayName: fd.get('displayName')?.toString() ?? '',
    };
    const parsed = registerSchema.safeParse({
      email: raw.email,
      password: raw.password,
      displayName: raw.displayName.length > 0 ? raw.displayName : undefined,
    });
    if (!parsed.success) {
      return fail(400, {
        ok: false,
        message: parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
        values: { email: raw.email, displayName: raw.displayName },
      });
    }

    const [existing] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, parsed.data.email))
      .limit(1);
    if (existing) {
      return fail(409, {
        ok: false,
        message: 'An account with that email already exists. Try signing in.',
        values: { email: raw.email, displayName: raw.displayName },
      });
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const [created] = await db
      .insert(schema.users)
      .values({
        email: parsed.data.email,
        passwordHash,
        displayName: parsed.data.displayName ?? null,
      })
      .returning();
    if (!created) {
      return fail(500, {
        ok: false,
        message: 'Could not create your account. Try again.',
        values: { email: raw.email, displayName: raw.displayName },
      });
    }

    const session = await createSession(created.id);
    setSessionCookie(cookies, session.token, session.expiresAt, isSecureRequest(url));

    // Send a verification magic-link (T-11.7). The same magic-link
    // consumer in $lib/server/auth/magic-link.ts sets
    // email_verified_at on click, so this email doubles as both
    // "welcome" and "click to verify your email." Failures are
    // logged but don't block signup — the user can resend later
    // via /api/v1/auth/verify-email/resend.
    try {
      const token = await createMagicLink(created.id);
      const verifyUrl = `${APP_BASE_URL}/auth/magic/${encodeURIComponent(token)}`;
      await sendMail(buildMagicLinkEmail(created.email, verifyUrl));
    } catch (err) {
      console.error('Failed to send verification email on register:', err);
    }

    throw redirect(303, readNext(url));
  },
};
