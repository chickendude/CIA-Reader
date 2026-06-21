/**
 * Anki export page. With `?textId` it shows the book's learning words ready to
 * export; without it, a picker of the user's books. Auth-gated.
 */
import { redirect } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';

import { getAnkiCards } from '$lib/server/anki.js';
import { db, schema } from '$lib/server/db/index.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
  if (!locals.user) throw redirect(303, '/login');
  const userId = locals.user.id;

  const textId = url.searchParams.get('textId');
  if (textId) {
    const [text] = await db
      .select({ title: schema.texts.title, language: schema.texts.language })
      .from(schema.texts)
      .where(eq(schema.texts.id, textId))
      .limit(1);
    const { language, cards } = await getAnkiCards(userId, { textId });
    const title = text?.title ?? 'this book';
    return {
      mode: 'export' as const,
      textId,
      title,
      language,
      cards,
      deckName: `CIA Reader::${title}`,
    };
  }

  // Picker: the user's own books to export from.
  const texts = await db
    .select({
      id: schema.texts.id,
      title: schema.texts.title,
      language: schema.texts.language,
    })
    .from(schema.texts)
    .where(eq(schema.texts.ownerId, userId))
    .orderBy(desc(schema.texts.createdAt))
    .limit(100);

  return { mode: 'pick' as const, texts };
};
