/**
 * GET/PATCH /api/v1/me/text-progress/:textId (T-5.6).
 *
 * PATCH: reader writes its debounced anchor here as the user scrolls /
 * paginates. The values are persisted to user_text_progress. A 404
 * is returned if the viewer can't read the text — either it
 * doesn't exist or the canReadText helper says no.
 *
 * GET: the viewer's saved anchor for this text, or null if none. The
 * Android reader reads this on open to resume; the web reader reads the
 * same progress server-side in its page loader.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  getTextProgress,
  ProgressNotAccessibleError,
  setTextProgress,
} from '$lib/server/texts/progress.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const body = z.object({
  chapterIdx: z.number().int().min(0),
  tokenIdx: z.number().int().min(0).optional().default(0),
  pctRead: z.number().min(0).max(100).optional().default(0),
});

export const GET: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const textId = event.params.textId;
  if (!textId || !UUID_RE.test(textId)) throw error(400, 'Invalid text id');
  const row = await getTextProgress(user.id, textId);
  return json({
    progress: row
      ? {
          userId: row.userId,
          textId: row.textId,
          lastChapterIdx: row.lastChapterIdx,
          lastTokenIdx: row.lastTokenIdx,
          pctRead: row.pctRead,
          updatedAt: row.updatedAt,
        }
      : null,
  });
};

export const PATCH: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const textId = event.params.textId;
  if (!textId || !UUID_RE.test(textId)) throw error(400, 'Invalid text id');

  let parsed: { chapterIdx: number; tokenIdx: number; pctRead: number };
  try {
    const json_body = await event.request.json();
    const result = body.safeParse(json_body);
    if (!result.success) throw error(400, 'Invalid body');
    parsed = result.data;
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) throw e;
    throw error(400, 'Invalid JSON body');
  }

  try {
    const row = await setTextProgress({
      userId: user.id,
      textId,
      lastChapterIdx: parsed.chapterIdx,
      lastTokenIdx: parsed.tokenIdx,
      pctRead: parsed.pctRead,
    });
    return json({
      progress: {
        userId: row.userId,
        textId: row.textId,
        lastChapterIdx: row.lastChapterIdx,
        lastTokenIdx: row.lastTokenIdx,
        pctRead: row.pctRead,
        updatedAt: row.updatedAt,
      },
    });
  } catch (err) {
    if (err instanceof ProgressNotAccessibleError) throw error(404, err.message);
    throw err;
  }
};
