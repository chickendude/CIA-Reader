import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { requireUser } from '$lib/server/auth/require-user';
import { setOccurrenceIgnored } from '$lib/server/texts/ignored-occurrences';
import { parseJson } from '../../../auth/_helpers';
import type { RequestHandler } from './$types';

const input = z.object({ ignored: z.boolean() });

export const PUT: RequestHandler = async (event) => {
  const user = await requireUser(event);
  if (!z.string().uuid().safeParse(event.params.id).success) error(404, 'Word not found');
  const { ignored } = await parseJson(event.request, input);
  await setOccurrenceIgnored(user.id, event.params.id, ignored);
  return new Response(null, { status: 204 });
};
