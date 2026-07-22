/**
 * GET /scan-assets/<storage-key> (dev backend only).
 *
 * Serves dictionary scan page images for the transcription workbench.
 * Clone of /pdf-assets with two differences: the gate is
 * curator-or-admin (workbench-only asset — scans of the still-US-
 * copyrighted Praharaj volumes shouldn't be a public URL), and only
 * `scans/` keys are served. The S3 backend would presign and bypass
 * this route.
 */
import { error } from '@sveltejs/kit';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { resolveUser } from '$lib/server/auth/require-user.js';
import { isCuratorOrAdmin } from '$lib/server/dictionary/permissions.js';
import { MIME_BY_EXT, isScanKey } from '$lib/server/pdf/storage.js';
import type { RequestHandler } from './$types';

const LOCAL_ROOT = process.env.PDF_LOCAL_ROOT ?? '/tmp/ciareader-pdf';

export const GET: RequestHandler = async (event) => {
  const key = event.params.key;
  if (!key) throw error(400, 'missing key');
  // Non-scan keys are a 404 (don't leak which keys exist), same policy
  // as pdf-assets' malformed-key handling.
  if (!isScanKey(key)) throw error(404, 'not found');

  const viewer = await resolveUser(event);
  if (!isCuratorOrAdmin(viewer)) throw error(404, 'not found');

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
      'cache-control': 'private, max-age=86400',
    },
  });
};
