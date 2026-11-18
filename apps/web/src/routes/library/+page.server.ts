import { loadLibrary } from './library-page';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => loadLibrary(event);
