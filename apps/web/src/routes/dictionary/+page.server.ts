import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ parent, url }) => {
  const { currentLanguage } = await parent();
  throw redirect(303, `/dictionary/${currentLanguage ?? 'hi'}${url.search}`);
};
