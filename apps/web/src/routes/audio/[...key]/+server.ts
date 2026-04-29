/**
 * GET /audio/<storage-key> (T-9.1, dev backend only).
 *
 * Serves audio blobs from the local volume in dev. The S3 backend
 * presigns URLs and bypasses this route entirely. Public — audio
 * is keyed under text-id paths and the canReadText gate runs at
 * the listing endpoint; once the player has the URL we don't
 * re-check (mirrors how a CDN edge would behave).
 */
import { error } from '@sveltejs/kit';
import { promises as fs } from 'node:fs';
import path from 'node:path';

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

export const GET: RequestHandler = async ({ params }) => {
  const key = params.key;
  if (!key) throw error(400, 'missing key');
  // Defense-in-depth against path traversal: refuse keys that
  // resolve outside LOCAL_ROOT.
  const resolved = path.resolve(LOCAL_ROOT, key);
  const root = path.resolve(LOCAL_ROOT);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw error(400, 'invalid key');
  }
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
      'cache-control': 'public, max-age=86400',
      // Stream-friendly: allow Range requests for the <audio> element.
      'accept-ranges': 'bytes',
    },
  });
};
