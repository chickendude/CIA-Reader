/**
 * GET + POST /api/v1/collections/:id/shares (T-8.4).
 *
 * The POST endpoint accepts EITHER `recipientUserId` (UUID) OR
 * `recipientEmail`. The email path is what the inline manage-shares
 * UI uses — it's the only piece of identifying information the owner
 * actually knows about a recipient. The UUID path stays available
 * for tooling / future API consumers that already have a user id.
 */
import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  CollectionError,
  grantCollectionShare,
  listCollectionSharesWithRecipients,
} from '$lib/server/collections.js';
import { db, schema } from '$lib/server/db/index.js';
import { emailSchema, parseJson } from '../../../auth/_helpers.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const postSchema = z
  .union([
    z.object({ recipientUserId: z.string().regex(UUID_RE) }).strict(),
    z.object({ recipientEmail: emailSchema }).strict(),
  ]);

export const GET: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid collection id');
  try {
    const shares = await listCollectionSharesWithRecipients(id, {
      id: user.id,
      role: user.role,
    });
    return json({ shares });
  } catch (e) {
    if (e instanceof CollectionError) throw error(e.status, e.message);
    throw e;
  }
};

export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid collection id');
  const body = await parseJson(event.request, postSchema);

  // Resolve the recipient — either passed by UUID or by email.
  let recipientUserId: string;
  if ('recipientUserId' in body) {
    recipientUserId = body.recipientUserId;
  } else {
    const [row] = (await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, body.recipientEmail))
      .limit(1)) as Array<{ id: string }>;
    if (!row) throw error(404, 'No user with that email');
    recipientUserId = row.id;
  }

  try {
    const share = await grantCollectionShare({
      collectionId: id,
      recipientUserId,
      actor: { id: user.id, role: user.role },
    });
    return json({ share }, { status: 201 });
  } catch (e) {
    if (e instanceof CollectionError) throw error(e.status, e.message);
    throw e;
  }
};
