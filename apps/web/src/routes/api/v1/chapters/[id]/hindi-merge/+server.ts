import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { requireUser } from '$lib/server/auth/require-user';
import { confirmHindiMerge, undoHindiMerge } from '$lib/server/texts/hindidb';
import type { RequestHandler } from './$types';

const selection = z.object({
  first: z.number().int().nonnegative(),
  last: z.number().int().positive(),
  lemmaId: z.string().uuid(),
  surface: z.string().min(1),
});

const changeMerge: RequestHandler = async (event) => {
  const actor = await requireUser(event);
  if (!z.string().uuid().safeParse(event.params.id).success) error(404, 'Chapter not found');
  const input = selection.safeParse(await event.request.json().catch(() => null));
  if (!input.success) error(400, 'Invalid merge selection');
  const change = event.request.method === 'DELETE' ? undoHindiMerge : confirmHindiMerge;
  await change(event.params.id, input.data, actor);
  return json({ saved: true });
};

export { changeMerge as POST, changeMerge as DELETE };
