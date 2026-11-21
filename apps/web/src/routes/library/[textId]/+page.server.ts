import { error, fail, redirect } from '@sveltejs/kit';
import { getOfficialBook, importOfficialBook, OfficialBookError } from '$lib/server/texts/official.js';
import { officialDeckRows, studyBands } from '$lib/server/texts/study-deck.js';
import { compareBooks, listComparisonBooks } from '$lib/server/texts/book-comparison.js';
import { isCuratorOrAdmin } from '$lib/server/dictionary/permissions.js';
import type { Actions, PageServerLoad } from './$types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readPercent(value: string | null) {
  if (value === null) return 98;
  const pct = Number(value);
  if (!value.trim() || pct < 0 || pct > 100 || !Number.isInteger(pct * 10)) {
    throw error(400, 'Enter a percentage from 0 to 100 with up to one decimal place.');
  }
  return pct;
}

export const load: PageServerLoad = async ({ params, locals, url }) => {
  if (!UUID.test(params.textId)) throw error(404, 'Book not found');
  const book = await getOfficialBook(params.textId, locals.user?.id);
  if (!book) throw error(404, 'Book not found');
  const books = await listComparisonBooks(book);
  const sourceId = url.searchParams.get('from') ?? (books.length === 1 ? books[0]?.id : undefined);
  const source = books.find((item) => item.id === sourceId);
  const known = readPercent(url.searchParams.get('known'));
  const goal = readPercent(url.searchParams.get('goal'));
  const [result, deckBands] = await Promise.all([
    source && url.searchParams.has('from') ? compareBooks(book, source.id, known, goal, locals.user?.id) : null,
    officialDeckRows(book, locals.user?.id).then(studyBands),
  ]);
  return { book, isStaff: isCuratorOrAdmin(locals.user), isAuthenticated: Boolean(locals.user),
    deckBands, comparison: { books, source, known, goal, result } };
};

export const actions: Actions = {
  import: async ({ params, locals }) => {
    if (!locals.user) throw redirect(303, `/login?next=${encodeURIComponent(`/library/${params.textId}`)}`);
    if (!UUID.test(params.textId)) throw error(404, 'Book not found');
    let textId: string;
    try { textId = await importOfficialBook(params.textId, locals.user.id); }
    catch (e) {
      if (e instanceof OfficialBookError) return fail(e.status, { message: e.message });
      throw e;
    }
    throw redirect(303, `/reader/${textId}`);
  },
};
