import { redirectWorkshop, workshopLanguage } from '$lib/server/dictionary/workshop-page';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, url }) => redirectWorkshop(workshopLanguage(params.language), url);
