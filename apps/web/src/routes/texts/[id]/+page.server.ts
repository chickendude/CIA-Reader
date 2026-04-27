/**
 * Placeholder text viewer (T-4.1).
 *
 * Renders the freshly uploaded text's chapters as raw paragraphs so the
 * upload flow has somewhere to land. The real reader (M5) replaces this
 * with token-aware rendering, the pop-up, paginated/continuous modes,
 * and known-words tracking. The contract this loader returns
 * (`{ text, chapters }`) is what the M5 reader will keep — it just
 * adds the tokenization layer on top.
 *
 * Authorization at T-4.1 is "owner only." T-4.6 swaps this out for
 * the central `assertCanRead` helper that also handles shared / official
 * visibility — for now, sharing is a future ticket so a non-owner gets
 * a flat 404 to avoid leaking text existence.
 */
import { error, redirect } from '@sveltejs/kit';

import { getOwnedText } from '$lib/server/texts/upload.js';
import type { PageServerLoad } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const load: PageServerLoad = async ({ params, locals, url }) => {
  if (!locals.user) {
    throw redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
  }
  if (!UUID_RE.test(params.id)) throw error(400, 'Invalid text id');
  const result = await getOwnedText({ id: locals.user.id }, params.id);
  if (!result) throw error(404, 'Text not found');
  return {
    text: {
      id: result.text.id,
      title: result.text.title,
      language: result.text.language,
      sourceType: result.text.sourceType,
      status: result.text.status,
      visibility: result.text.visibility,
      createdAt: result.text.createdAt,
    },
    chapters: result.chapters.map((c) => ({
      id: c.id,
      idx: c.idx,
      title: c.title,
      body: c.body,
      tokenCount: c.tokenCount,
    })),
  };
};
