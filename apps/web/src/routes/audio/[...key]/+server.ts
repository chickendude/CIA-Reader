/**
 * GET /audio/<storage-key> (T-9.1, dev backend only).
 *
 * Serves audio blobs from the local volume in dev. The S3 backend
 * presigns URLs and bypasses this route entirely. Local requests
 * check the parent text so restricted books stay restricted.
 */
import { error } from '@sveltejs/kit';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db/index.js';
import { resolveUser } from '$lib/server/auth/require-user.js';
import { canReadText } from '$lib/server/auth/can-read.js';

import type { RequestHandler } from './$types';

const LOCAL_ROOT =
  process.env.AUDIO_LOCAL_ROOT ?? '/tmp/ciareader-audio';

const MIME_BY_EXT: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.webm': 'audio/webm',
};

export const GET: RequestHandler = async (event) => {
  const { params } = event;
  const key = params.key;
  if (!key) throw error(400, 'missing key');
  // Defense-in-depth against path traversal: refuse keys that
  // resolve outside LOCAL_ROOT.
  const resolved = path.resolve(LOCAL_ROOT, key);
  const root = path.resolve(LOCAL_ROOT);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw error(400, 'invalid key');
  }
  const [row] = await db.select({ text: schema.texts }).from(schema.audioFiles)
    .innerJoin(schema.texts, eq(schema.texts.id, schema.audioFiles.textId))
    .where(eq(schema.audioFiles.storageKey, key)).limit(1);
  if (!row || !(await canReadText(await resolveUser(event), row.text))) throw error(404, 'audio not found');
  let body: Buffer;
  try {
    body = await fs.readFile(resolved);
  } catch {
    throw error(404, 'audio not found');
  }
  const ext = path.extname(resolved).toLowerCase();
  const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';
  return new Response(new Uint8Array(body), {
    headers: {
      'content-type': mime,
      'cache-control': 'private, no-store',
      // Stream-friendly: allow Range requests for the <audio> element.
      'accept-ranges': 'bytes',
    },
  });
};
