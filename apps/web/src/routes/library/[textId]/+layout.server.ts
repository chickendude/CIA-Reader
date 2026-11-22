import { error } from '@sveltejs/kit';
import { getOfficialBook } from '$lib/server/texts/official.js';
import { officialDeckRows, studyBands } from '$lib/server/texts/study-deck.js';
import { bookIdPattern, listComparisonBooks } from '$lib/server/texts/book-comparison.js';
import { isCuratorOrAdmin } from '$lib/server/dictionary/permissions.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ params, locals }) => {
  if (!bookIdPattern.test(params.textId)) throw error(404, 'Book not found');
  const book = await getOfficialBook(params.textId, locals.user?.id);
  if (!book) throw error(404, 'Book not found');
  const [books, deckBands] = await Promise.all([
    listComparisonBooks(book),
    officialDeckRows(book, locals.user?.id).then(studyBands),
  ]);
  return { book, books, deckBands, isStaff: isCuratorOrAdmin(locals.user), isAuthenticated: Boolean(locals.user) };
};
