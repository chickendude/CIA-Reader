import { loadWorkshop, workshopLanguage } from '$lib/server/dictionary/workshop-page';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, locals, url }) =>
  loadWorkshop(workshopLanguage(params.language), locals.user, url);
