/**
 * Placeholder text viewer (T-4.1, generalized in T-4.6).
 *
 * Renders the text's chapters as raw paragraphs. The real reader
 * (M5) replaces this with token-aware rendering, the pop-up, the
 * three reading modes, and known-words tracking. The contract this
 * loader returns (`{ text, chapters }`) is what the M5 reader will
 * keep — it just adds the tokenization layer on top.
 *
 * Authorization runs through the central `getReadableText` helper
 * (T-4.6): owner OR official visibility passes, anything else falls
 * through to a 404 to avoid leaking text existence. This means
 * official texts are readable without signing in — important for the
 * public marketing surface (T-7.6).
 */
import { error } from '@sveltejs/kit';

import { getReadableText } from '$lib/server/texts/upload.js';
import type { PageServerLoad } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!UUID_RE.test(params.id)) throw error(400, 'Invalid text id');
  // `viewer` is null for anonymous visitors — the helper allows them
  // to read official texts but rejects everything else.
  const viewer = locals.user ? { id: locals.user.id } : null;
  const result = await getReadableText(viewer, params.id);
  if (!result) throw error(404, 'Text not found');
  return {
    text: {
      id: result.text.id,
      title: result.text.title,
      language: result.text.language,
      sourceType: result.text.sourceType,
      status: result.text.status,
      statusError: result.text.statusError,
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
    isOwner: Boolean(locals.user && locals.user.id === result.text.ownerId),
  };
};
