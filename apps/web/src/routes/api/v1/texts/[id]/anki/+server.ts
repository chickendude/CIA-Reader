import { error } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth/require-user.js';
import { buildApkg } from '$lib/server/anki.js';
import { getOfficialBook, getOfficialBookCards, type OfficialDeckScope } from '$lib/server/texts/official.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const id = event.params.id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw error(404, 'Book not found');
  const params = event.url.searchParams;
  const scope = params.get('scope') ?? 'unknown';
  if (!['target', 'unknown', 'learning', 'all'].includes(scope)) throw error(400, 'Invalid vocabulary selection');
  const target = Number(params.get('target') ?? 98);
  if (target <= 0 || target > 100 || !Number.isInteger(target * 10)) {
    throw error(400, 'Enter a target from 0.1 to 100 with up to one decimal place.');
  }
  const book = await getOfficialBook(id);
  if (!book) throw error(404, 'Book not found');
  const cards = await getOfficialBookCards(id, user.id, scope as OfficialDeckScope, {
    includeStudied: params.get('includeStudied') === '1',
    target, ignoreProper: params.get('ignoreProper') === '1', ignoreLoans: params.get('ignoreLoans') === '1',
  });
  if (!cards.length) throw error(404, 'No words match this selection');
  const deck = await buildApkg(`Parhiba::${book.title}`, cards);
  const filename = `${book.title.replace(/[^\p{L}\p{N}\-_. ]/gu,'').trim() || 'Vocabulary'}.apkg`;
  return new Response(deck as unknown as BodyInit, { headers: {
    'content-type': 'application/octet-stream',
    'content-disposition': `attachment; filename="vocabulary.apkg"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'cache-control': 'private, no-store',
  } });
};
