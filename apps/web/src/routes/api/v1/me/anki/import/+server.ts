import { error, json } from '@sveltejs/kit';
import { ankiEntryKey } from '$lib/anki-connect.js';
import { requireUser } from '$lib/server/auth/require-user.js';
import { ankiImportInput, importAnkiVocabulary } from '$lib/server/anki-import.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const parsed = ankiImportInput.safeParse(await event.request.json().catch(() => null));
  if (!parsed.success) throw error(400, 'Invalid Anki entries');
  const keys = parsed.data.entries.map(ankiEntryKey);
  if (new Set(keys).size !== keys.length) throw error(400, 'Duplicate entries');
  return json(await importAnkiVocabulary(user.id, parsed.data));
};
