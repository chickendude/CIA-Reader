import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';

import { registerAccount } from '$lib/server/auth/password-access.js';
import { sendAccountLink } from '$lib/server/email/account-link.js';
import { createSession, setSessionCookie } from '$lib/server/auth/sessions.js';
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
  if (!raw.startsWith('/') || !URL.canParse(raw, url)) return '/onboarding';
  const destination = new URL(raw, url);
  if (destination.origin !== url.origin || destination.pathname.startsWith('//')) return '/onboarding';
  return destination.pathname + destination.search + destination.hash;
}

export const load: PageServerLoad = ({ locals, url }) => {
  const received = url.searchParams.has('received');
  if (locals.user && !received) {
    throw redirect(303, readNext(url));
  }
  return { next: readNext(url), received };
};

export const actions: Actions = {
  default: async ({ request, cookies, url, getClientAddress }) => {
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

    const result = await registerAccount(parsed.data, getClientAddress);
    if (result.status === 'existing') {
      return fail(409, {
        ok: false,
        message: 'An account with that email already exists. Try signing in.',
        values: { email: raw.email, displayName: raw.displayName },
      });
    }
    if (result.status === 'created') {
      const session = await createSession(result.user.id, getClientAddress, true);
      setSessionCookie(cookies, session.token, session.expiresAt, isSecureRequest(url));
      try {
        await sendAccountLink(result.user, 'verification');
      } catch (err) {
        console.error('Failed to send registration email:', err);
      }
    }
    const query = new URLSearchParams({ received: '1', next: readNext(url) });
    throw redirect(303, `/register?${query}`);
  },
};
