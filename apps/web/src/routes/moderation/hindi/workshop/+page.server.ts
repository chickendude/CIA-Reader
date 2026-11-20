import { loadWorkshop } from '$lib/server/dictionary/workshop-page';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => loadWorkshop('hi', locals.user, url);
