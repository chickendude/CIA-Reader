/**
 * POST /api/v1/audio/:id/alignments/import (T-9.6).
 *
 * Body: { format: 'whisper' | 'webvtt', payload: <string|object> }.
 * Maps imported word timings to text_tokens by reading-order index
 * (isWord-only) and replaces the alignment set in one call.
 */
import { error, json } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  AlignmentError,
  replaceAlignments,
} from '$lib/server/audio/alignments.js';
import {
  AlignmentImportError,
  matchWordsToTokens,
  parseWebVtt,
  parseWhisperJson,
} from '$lib/server/audio/import-export.js';
import { db, schema } from '$lib/server/db/index.js';
import type { TextToken } from '$lib/server/db/schema.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid audio id');
  const body = (await event.request.json()) as {
    format?: string;
    payload?: unknown;
  };
  if (body.format !== 'whisper' && body.format !== 'webvtt') {
    throw error(400, 'format must be "whisper" or "webvtt"');
  }

  // Resolve the audio's chapter so we know which token order to
  // pair against. Whole-text audio is out of scope here (matches
  // the manual editor's chapter-bound contract).
  const [audio] = (await db
    .select({
      audioId: schema.audioFiles.id,
      chapterId: schema.audioFiles.chapterId,
    })
    .from(schema.audioFiles)
    .where(eq(schema.audioFiles.id, id))
    .limit(1)) as Array<{ audioId: string; chapterId: string | null }>;
  if (!audio) throw error(404, 'Audio not found');
  if (!audio.chapterId) {
    throw error(
      400,
      'Import is only supported for chapter-bound audio at this layer',
    );
  }

  const tokens = (await db
    .select({
      id: schema.textTokens.id,
      isWord: schema.textTokens.isWord,
    })
    .from(schema.textTokens)
    .where(eq(schema.textTokens.chapterId, audio.chapterId))
    .orderBy(asc(schema.textTokens.idx))) as Array<
    Pick<TextToken, 'id' | 'isWord'>
  >;

  let words;
  try {
    words =
      body.format === 'whisper'
        ? parseWhisperJson(body.payload)
        : parseWebVtt(String(body.payload ?? ''));
  } catch (e) {
    if (e instanceof AlignmentImportError) throw error(400, e.message);
    throw e;
  }

  const matched = matchWordsToTokens(words, tokens);
  try {
    const written = await replaceAlignments({
      audioFileId: id,
      alignments: matched.alignments,
      source: 'imported',
      actor: { id: user.id, role: user.role },
    });
    return json({
      ok: true,
      written,
      imported: matched.imported,
      available: matched.available,
    });
  } catch (e) {
    if (e instanceof AlignmentError) throw error(e.status, e.message);
    throw e;
  }
};
