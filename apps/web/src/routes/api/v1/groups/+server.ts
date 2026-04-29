/**
 * POST /api/v1/groups (T-7.3) — create a new group; the actor
 * becomes the owner + first member.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import { GroupError, createGroup } from '$lib/server/groups.js';
import { parseJson } from '../auth/_helpers.js';
import type { RequestHandler } from './$types';

const bodySchema = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().max(1000).nullable().optional(),
  })
  .strict();

export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const body = await parseJson(event.request, bodySchema);
  try {
    const group = await createGroup({
      ownerId: user.id,
      name: body.name,
      description: body.description ?? null,
    });
    return json({ group }, { status: 201 });
  } catch (e) {
    if (e instanceof GroupError) throw error(e.status, e.message);
    throw e;
  }
};
