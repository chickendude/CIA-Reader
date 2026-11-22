import { redirect } from '@sveltejs/kit';
import { workshopPath } from '$lib/dictionary/profiles';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
  const params = new URLSearchParams(url.searchParams);
  params.delete('id');
  params.delete('view');
  if (!params.has('kind')) params.set('kind', 'unresolved');
  redirect(308, workshopPath('hi') + '?' + params);
};
