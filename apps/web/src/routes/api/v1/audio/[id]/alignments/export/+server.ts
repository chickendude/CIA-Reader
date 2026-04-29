/**
 * GET /api/v1/audio/:id/alignments/export?format=whisper|webvtt
 * (T-9.6).
 */
import { error } from '@sveltejs/kit';
import { inArray } from 'drizzle-orm';

import { listAlignments } from '$lib/server/audio/alignments.js';
import {
  toWebVtt,
  toWhisperJson,
} from '$lib/server/audio/import-export.js';
import { db, schema } from '$lib/server/db/index.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET: RequestHandler = async ({ params, url }) => {
  const id = params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid audio id');
  const format = url.searchParams.get('format') ?? 'whisper';
  if (format !== 'whisper' && format !== 'webvtt') {
    throw error(400, 'format must be "whisper" or "webvtt"');
  }
  const rows = await listAlignments(id);
  // Pull each token's surface so the export carries human-readable
  // word strings; otherwise we'd emit empty `word` fields.
  const tokenIds = rows.map((r) => r.tokenId);
  const surfaces = new Map<string, string>();
  if (tokenIds.length > 0) {
    const surf = (await db
      .select({
        id: schema.textTokens.id,
        surface: schema.textTokens.surface,
      })
      .from(schema.textTokens)
      .where(inArray(schema.textTokens.id, tokenIds))) as Array<{
      id: string;
      surface: string;
    }>;
    for (const r of surf) surfaces.set(r.id, r.surface);
  }

  if (format === 'whisper') {
    return new Response(JSON.stringify(toWhisperJson(rows, surfaces), null, 2), {
      headers: {
        'content-type': 'application/json',
        'content-disposition': `attachment; filename="alignment-${id}.json"`,
      },
    });
  }
  const vtt = toWebVtt(rows, surfaces);
  return new Response(vtt, {
    headers: {
      'content-type': 'text/vtt; charset=utf-8',
      'content-disposition': `attachment; filename="alignment-${id}.vtt"`,
    },
  });
};
