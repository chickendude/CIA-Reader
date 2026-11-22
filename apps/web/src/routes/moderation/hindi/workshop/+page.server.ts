import { redirectWorkshop } from '$lib/server/dictionary/workshop-page';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => redirectWorkshop('hi', url);
