import { readReviewFilter } from '$lib/dictionary/review-status';
import { error } from '@sveltejs/kit';
import { reviewDestination } from '$lib/dictionary/hindi-review-link';
import { z } from 'zod';
import { reviewBooks, reviewPage } from '$lib/server/texts/hindi-review.js';
import { OPENAI_API_KEY, OPENAI_MODEL } from '$lib/server/env.js';
import { ContextChoiceError } from '$lib/server/texts/hindi-context.js';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, url }) => {
  if (!locals.user) throw error(403, 'Staff access required');
  try {
    const books = await reviewBooks(locals.user);
    const textId = url.searchParams.get('textId') ?? books[0]?.id;
    const view = url.searchParams.get('kind');
    const offset = Math.max(
      0,
      Math.min(Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 10000000),
    );
    const status = readReviewFilter(url.searchParams.get('status') ?? (view === 'unparsed' ? 'unparsed' : null));
    const query = (url.searchParams.get('q') ?? '').slice(0, 200);
    if (textId && !z.string().uuid().safeParse(textId).success) throw error(404, 'Book not found');
    return {
      books,
      result: textId ? await reviewPage(textId, locals.user, offset, query, status) : null,
      status,
      destination: reviewDestination(url),
      query,
      aiConfigured: Boolean(OPENAI_API_KEY),
      aiModel: OPENAI_MODEL,
    };
  } catch (e) {
    if (e instanceof ContextChoiceError) throw error(e.status, e.message);
    throw e;
  }
};
