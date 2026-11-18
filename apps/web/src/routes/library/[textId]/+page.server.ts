import { error, fail, redirect } from '@sveltejs/kit';
import { getOfficialBook, importOfficialBook, OfficialBookError } from '$lib/server/texts/official.js';
import { isCuratorOrAdmin } from '$lib/server/dictionary/permissions.js';
import type { Actions, PageServerLoad } from './$types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!UUID.test(params.textId)) throw error(404, 'Book not found');
  const book = await getOfficialBook(params.textId, locals.user?.id);
  if (!book) throw error(404, 'Book not found');
  return { book, isStaff: isCuratorOrAdmin(locals.user), isAuthenticated: Boolean(locals.user) };
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
