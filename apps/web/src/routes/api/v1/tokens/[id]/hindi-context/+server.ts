import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { requireUser } from '$lib/server/auth/require-user.js';
import { ContextChoiceError, saveHindiContextChoice } from '$lib/server/texts/hindi-context.js';
import { loadChapterTokens } from '$lib/server/texts/tokens.js';
import type { RequestHandler } from './$types';

const input = z.object({
  selectedLemmaIds: z.array(z.string().uuid()).max(64),
  expectedVersion: z.string().length(64),
});
export const PATCH: RequestHandler = async (event) => {
  const user = await requireUser(event);
  if (!z.string().uuid().safeParse(event.params.id).success) throw error(404, 'Word not found');
  const parsed = input.safeParse(await event.request.json().catch(() => null));
  if (!parsed.success) throw error(400, 'Invalid selection');
  try {
    const { chapterId, textId } = await saveHindiContextChoice(
      event.params.id,
      parsed.data.selectedLemmaIds,
      parsed.data.expectedVersion,
      user,
    );
    const token = (await loadChapterTokens(chapterId, user.id, textId))?.find(
      (t) => t.id === event.params.id,
    );
    return json({ token });
  } catch (e) {
    if (e instanceof ContextChoiceError) throw error(e.status, e.message);
    throw e;
  }
};
