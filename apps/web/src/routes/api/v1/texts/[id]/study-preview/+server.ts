import { error, json } from '@sveltejs/kit';
import { bookIdPattern, readBookPercent } from '$lib/server/texts/book-comparison.js';
import { getOfficialBookMetadata } from '$lib/server/texts/official.js';
import { officialDeckRows, studyBands } from '$lib/server/texts/study-deck.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, locals }) => {
  if (!bookIdPattern.test(params.id)) throw error(404, 'Book not found');
  const book = await getOfficialBookMetadata(params.id);
  if (!book) throw error(404, 'Book not found');
  const knownBook = { id: url.searchParams.get('knownBook') ?? '', coverage: readBookPercent(url.searchParams.get('knownCoverage')) };
  const rows = await officialDeckRows(book, locals.user?.id, knownBook);
  return json(studyBands(rows), { headers: { 'cache-control': 'private, no-store' } });
};
