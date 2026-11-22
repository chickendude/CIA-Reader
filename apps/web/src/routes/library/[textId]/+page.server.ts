import { error, fail, redirect } from '@sveltejs/kit';
import { importOfficialBook, OfficialBookError } from '$lib/server/texts/official.js';
import { bookIdPattern, compareBooks, readBookPercent } from '$lib/server/texts/book-comparison.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, locals, url }) => {
  const { book, books } = await parent();
  const sourceId = url.searchParams.get('from') ?? (books.length === 1 ? books[0]?.id : undefined);
  const source = books.find((item) => item.id === sourceId);
  const known = readBookPercent(url.searchParams.get('known'));
  const goal = readBookPercent(url.searchParams.get('goal'));
  const result = source && url.searchParams.has('from')
    ? await compareBooks(book, source.id, known, goal, locals.user?.id) : null;
  return { comparison: { source, known, goal, result } };
};

export const actions: Actions = {
  import: async ({ params, locals }) => {
    if (!locals.user) throw redirect(303, `/login?next=${encodeURIComponent(`/library/${params.textId}`)}`);
    if (!bookIdPattern.test(params.textId)) throw error(404, 'Book not found');
    let textId: string;
    try { textId = await importOfficialBook(params.textId, locals.user.id); }
    catch (e) {
      if (e instanceof OfficialBookError) return fail(e.status, { message: e.message });
      throw e;
    }
    throw redirect(303, `/reader/${textId}`);
  },
};
