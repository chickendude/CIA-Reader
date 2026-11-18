import { error } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth/require-user.js';
import { buildApkg } from '$lib/server/anki.js';
import { getOfficialBook, getOfficialBookCards, type OfficialDeckScope } from '$lib/server/texts/official.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const id = event.params.id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw error(404, 'Book not found');
  const scope = event.url.searchParams.get('scope') ?? 'unknown';
  if (!['unknown','learning','all'].includes(scope)) throw error(400, 'Invalid vocabulary selection');
  const book = await getOfficialBook(id);
  if (!book) throw error(404, 'Book not found');
  const cards = await getOfficialBookCards(id, user.id, scope as OfficialDeckScope);
  if (!cards.length) throw error(404, 'No words match this selection');
  const deck = await buildApkg(`Parhiba::${book.title}`, cards);
  const filename = `${book.title.replace(/[^\p{L}\p{N}\-_. ]/gu,'').trim() || 'Vocabulary'}.apkg`;
  return new Response(deck as unknown as BodyInit, { headers: {
    'content-type': 'application/octet-stream',
    'content-disposition': `attachment; filename="vocabulary.apkg"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'cache-control': 'private, no-store',
  } });
};
