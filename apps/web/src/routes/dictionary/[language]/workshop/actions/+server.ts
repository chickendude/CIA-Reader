import { workshopAction } from '$lib/server/dictionary/workshop-actions';
import { workshopLanguage } from '$lib/server/dictionary/workshop-page';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = event => workshopAction(workshopLanguage(event.params.language), event);
