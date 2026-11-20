import { workshopAction } from '$lib/server/dictionary/workshop-actions';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = event => workshopAction('hi', event);
