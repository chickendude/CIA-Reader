import { loadHindiWorkshop } from '$lib/server/dictionary/workshop-page';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => loadHindiWorkshop(locals.user, url);
