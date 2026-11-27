import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { db, schema } from '$lib/server/db/index.js';
import { sendAccountLink } from '$lib/server/email/account-link.js';
import { emailSchema, parseJson } from '../../_helpers.js';

const body = z.object({ email: emailSchema });

export const POST: RequestHandler = async ({ request }) => {
  const input = await parseJson(request, body);

  const [user] = await db
    .select({ id: schema.users.id, email: schema.users.email, emailVerifiedAt: schema.users.emailVerifiedAt })
    .from(schema.users)
    .where(eq(schema.users.email, input.email))
    .limit(1);

  // Always respond with 200 to avoid leaking which emails are registered.
  if (user) {
    try {
      await sendAccountLink(user, 'signin');
    } catch (err) {
      console.error('Failed to send magic-link email:', err);
      // Swallow — surfacing the error would also leak account existence.
    }
  }

  return json({ ok: true });
};
