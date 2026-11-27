import { error, redirect } from '@sveltejs/kit';
import { isSupportedLanguage } from '@ciareader/shared-types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, url }) => {
  const { moderator } = await parent();
  const query = new URLSearchParams(url.searchParams);
  if (!query.size) redirect(303, '/moderation');

  // Old bookmarks may identify the dictionary by language or just a search term.
  const requested = query.get('language');
  const language = requested && isSupportedLanguage(requested) ? requested : moderator.grantedLanguages[0];
  if (!language) redirect(303, '/moderation');
  if (!moderator.grantedLanguages.includes(language)) error(403, 'Language grant required');
  query.delete('language');
  redirect(303, `/dictionary/${language}${query.size ? '?' + query : ''}`);
};
