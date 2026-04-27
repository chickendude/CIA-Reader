/**
 * POST /api/v1/texts/epub (T-4.3).
 *
 * Multipart endpoint for EPUB uploads. The request body is form-data
 * with three fields:
 *
 *   - `language` — 'hi' | 'mr' | 'or' (string)
 *   - `title` — visible title (string; optional, defaults to filename)
 *   - `file` — the .epub File blob
 *
 * We keep this on its own URL because EPUB is binary and JSON-encoding
 * the bytes (base64 → JSON) would inflate by ~33% on the wire and
 * force the client to parse the file twice. Multipart is the right
 * primitive — every browser <input type="file"> form action posts it
 * natively.
 *
 * Response shape mirrors POST /api/v1/texts (T-4.1/T-4.2): 201 with
 * the new text metadata + `chapterCount` so the redirect target can
 * surface "uploaded N chapters" in M5.
 */
import { error, json } from '@sveltejs/kit';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  createEpubText,
  EpubParseError,
  TextValidationError,
  MAX_EPUB_BYTES,
  MAX_TITLE_LEN,
  MIN_TITLE_LEN,
} from '$lib/server/texts/upload.js';
import type { RequestHandler } from './$types';

const SUPPORTED_LANGS = new Set(['hi', 'mr', 'or']);

export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  let fd: FormData;
  try {
    fd = await event.request.formData();
  } catch {
    throw error(400, 'Expected multipart/form-data body');
  }
  const language = fd.get('language')?.toString() ?? '';
  const titleRaw = fd.get('title')?.toString() ?? '';
  const file = fd.get('file');
  if (!SUPPORTED_LANGS.has(language)) {
    throw error(400, `Unsupported language '${language}'`);
  }
  if (!(file instanceof File)) {
    throw error(400, 'Missing file field');
  }
  if (file.size === 0) {
    throw error(400, 'File is empty');
  }
  if (file.size > MAX_EPUB_BYTES) {
    throw error(
      400,
      `File exceeds ${MAX_EPUB_BYTES.toLocaleString()} bytes`,
    );
  }
  // If no title was provided, fall back to the filename without the
  // extension. Easier than asking the user to retype something they
  // already named on disk.
  let title = titleRaw.trim();
  if (title.length === 0) {
    title = file.name.replace(/\.epub$/i, '').trim();
  }
  if (title.length < MIN_TITLE_LEN) {
    throw error(400, 'title is required');
  }
  if (title.length > MAX_TITLE_LEN) {
    throw error(400, `title exceeds ${MAX_TITLE_LEN} characters`);
  }

  const epubBytes = new Uint8Array(await file.arrayBuffer());
  try {
    const created = await createEpubText(
      { id: user.id },
      {
        language,
        title,
        epubBytes,
      },
    );
    const { text } = created;
    return json(
      {
        text: {
          id: text.id,
          ownerId: text.ownerId,
          language: text.language,
          title: text.title,
          sourceType: text.sourceType,
          status: text.status,
          visibility: text.visibility,
          createdAt: text.createdAt,
        },
        chapterCount: created.chapters.length,
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof TextValidationError) throw error(err.status, err.message);
    if (err instanceof EpubParseError) throw error(400, err.message);
    throw err;
  }
};
