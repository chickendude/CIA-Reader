import { error } from '@sveltejs/kit';
import { recentSiteActivity } from '$lib/server/auth/user-directory.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, url, setHeaders }) => {
  const { moderator } = await parent();
  if (url.searchParams.get('tab') !== 'site') return { activity: null };
  if (moderator.role !== 'admin') error(403, 'Admin role required');
  setHeaders({ 'cache-control': 'private, no-store' });
  return { activity: await recentSiteActivity() };
};
