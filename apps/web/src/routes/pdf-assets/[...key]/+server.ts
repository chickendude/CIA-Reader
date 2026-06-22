/**
 * GET /pdf-assets/<storage-key> (dev backend only).
 *
 * Serves PDF page images from the local volume in dev. The S3 backend
 * presigns URLs and bypasses this route entirely.
 *
 * Unlike audio (which is effectively public once the URL is known),
 * page images can reproduce a private/copyrighted book, so each request
 * runs a `canReadText` gate keyed off the text id embedded in the
 * storage key (`texts/<id>/pages/...`).
 */
import { error } from '@sveltejs/kit';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { getReadableText } from '$lib/server/texts/upload.js';
import { MIME_BY_EXT, textIdFromPageKey } from '$lib/server/pdf/storage.js';
import type { RequestHandler } from './$types';

const LOCAL_ROOT = process.env.PDF_LOCAL_ROOT ?? '/tmp/ciareader-pdf';

export const GET: RequestHandler = async ({ params, locals }) => {
  const key = params.key;
  if (!key) throw error(400, 'missing key');

  // Only serve page images, and only to viewers allowed to read the
  // parent text. A malformed / non-page key is a 404 (don't leak which
  // keys exist).
  const textId = textIdFromPageKey(key);
  if (!textId) throw error(404, 'not found');
  const viewer = locals.user ? { id: locals.user.id } : null;
  const readable = await getReadableText(viewer, textId);
  if (!readable) throw error(404, 'not found');

  // Defense-in-depth against path traversal: refuse keys that resolve
  // outside LOCAL_ROOT.
  const resolved = path.resolve(LOCAL_ROOT, key);
  const root = path.resolve(LOCAL_ROOT);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw error(400, 'invalid key');
  }

  let body: Buffer;
  try {
    body = await fs.readFile(resolved);
  } catch {
    throw error(404, 'not found');
  }
  const ext = path.extname(resolved).toLowerCase();
  const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';
  return new Response(new Uint8Array(body), {
    headers: {
      'content-type': mime,
      // Private: a logged-in reader's page images shouldn't be cached by
      // shared proxies. The browser may still cache per-session.
      'cache-control': 'private, max-age=86400',
    },
  });
};
