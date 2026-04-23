import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { db, schema } from '$lib/server/db/index.js';
import { createMagicLink } from '$lib/server/auth/magic-link.js';
import { buildMagicLinkEmail, sendMail } from '$lib/server/email/index.js';
import { APP_BASE_URL } from '$lib/server/env.js';
import { emailSchema, parseJson } from '../../_helpers.js';

const body = z.object({ email: emailSchema });

export const POST: RequestHandler = async ({ request }) => {
  const input = await parseJson(request, body);

  const [user] = await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.email, input.email))
    .limit(1);

  // Always respond with 200 to avoid leaking which emails are registered.
  if (user) {
    const token = await createMagicLink(user.id);
    const url = `${APP_BASE_URL}/auth/magic/${encodeURIComponent(token)}`;
    try {
      await sendMail(buildMagicLinkEmail(user.email, url));
    } catch (err) {
      console.error('Failed to send magic-link email:', err);
      // Swallow — surfacing the error would also leak account existence.
    }
  }

  return json({ ok: true });
};
