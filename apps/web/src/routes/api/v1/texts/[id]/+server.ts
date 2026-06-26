/**
 * DELETE /api/v1/texts/:id
 *
 * Owner-or-admin only. Removes the text and cascades through every
 * dependent table (chapters, tokens, NLP jobs, shares, progress,
 * collection items, audio). Non-admins who don't own the row get the
 * same 404 as if it didn't exist so we don't leak existence.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser, resolveUser } from '$lib/server/auth/require-user.js';
import {
  deleteText,
  getReadableText,
  TextValidationError,
  updateText,
} from '$lib/server/texts/upload.js';
import { estimatedComprehensionForText } from '$lib/server/learning-stats.js';
import { parseJson } from '../../auth/_helpers.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Texts have no description column — rename (title) is the only edit.
const patchSchema = z.object({ title: z.string().min(1).max(200) });

/**
 * GET /api/v1/texts/:id — text metadata + a lightweight chapter list (idx,
 * title, tokenCount; no chapter bodies). The web reads this from its page
 * loader; an API client (the Android reader) needs it to show the title and
 * page through chapters. resolveUser so an official/public text is readable
 * anonymously; getReadableText returns null (→ 404) when the viewer can't
 * read it, so a private text never leaks its existence.
 */
export const GET: RequestHandler = async (event) => {
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid text id');
  const viewer = await resolveUser(event);
  const result = await getReadableText(viewer ? { id: viewer.id } : null, id);
  if (!result) throw error(404, 'Text not found');
  const { text, chapters } = result;
  // Viewer-specific reading comprehension (known word-token occurrences ÷
  // total). Null for anonymous viewers or before the worker has tokenized it.
  const comprehensionPct = viewer
    ? await estimatedComprehensionForText(viewer.id, id)
    : null;
  return json({
    text: {
      id: text.id,
      ownerId: text.ownerId,
      language: text.language,
      title: text.title,
      sourceType: text.sourceType,
      status: text.status,
      visibility: text.visibility,
      createdAt: text.createdAt,
      updatedAt: text.updatedAt,
    },
    chapterCount: chapters.length,
    comprehensionPct,
    chapters: chapters.map((c) => ({
      idx: c.idx,
      title: c.title,
      tokenCount: c.tokenCount,
    })),
  });
};

/**
 * PATCH /api/v1/texts/:id — rename a text. Owner-or-admin only; a non-owner
 * non-admin gets the same 404 as a missing text so existence never leaks.
 */
export const PATCH: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid text id');
  const body = await parseJson(event.request, patchSchema);
  try {
    const text = await updateText(id, { id: user.id, role: user.role }, body);
    return json({ text });
  } catch (e) {
    if (e instanceof TextValidationError) throw error(e.status, e.message);
    throw e;
  }
};

export const DELETE: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid text id');
  try {
    await deleteText(id, { id: user.id, role: user.role });
    return json({ ok: true });
  } catch (e) {
    if (e instanceof TextValidationError) throw error(e.status, e.message);
    throw e;
  }
};
