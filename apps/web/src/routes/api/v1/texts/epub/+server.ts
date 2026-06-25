/**
 * POST /api/v1/texts/epub (T-4.3, extended for chapter-book upload).
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
 * Response shape:
 *
 *   - Multi-chapter EPUB → 201 with `{ kind: 'collection',
 *     collection, textCount }`. Each spine chapter becomes its own
 *     `texts` row inside a `collections` row of kind `chapter_book`.
 *   - Single-chapter EPUB → 201 with `{ kind: 'text', text,
 *     chapterCount: 1 }` (1-item collections are awkward UX).
 *
 * Clients branch on `kind` to redirect to `/collections/<id>` or
 * `/reader/<id>`.
 */
import { error, json } from '@sveltejs/kit';

import { requireVerifiedUser } from '$lib/server/auth/require-user.js';
import {
  consumeRateLimit,
  rateLimitHeaders,
  RequestRateLimitError,
} from '$lib/server/auth/rate-limits.js';
import {
  createChapterBookFromEpub,
  EpubParseError,
  TextValidationError,
  MAX_EPUB_BYTES,
  MAX_TITLE_LEN,
  MIN_TITLE_LEN,
} from '$lib/server/texts/upload.js';
import type { RequestHandler } from './$types';
import { SUPPORTED_LANGUAGE_CODES } from '@ciareader/shared-types';

const SUPPORTED_LANGS = new Set<string>(SUPPORTED_LANGUAGE_CODES);

// T-11.2: EPUB ingest is expensive (chunking + parsing + chapter
// fan-out), so the daily quota is tighter than the paste / .txt
// path. 10/day still covers a learner working through a course.
const EPUB_UPLOADS_PER_DAY = 10;
const UPLOAD_WINDOW_MS = 24 * 60 * 60 * 1_000;

export const POST: RequestHandler = async (event) => {
  const user = await requireVerifiedUser(event);
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
    const requestLimit = await consumeRateLimit(event, user.id, {
      scope: 'texts:epub',
      limit: EPUB_UPLOADS_PER_DAY,
      windowMs: UPLOAD_WINDOW_MS,
    });
    const created = await createChapterBookFromEpub(
      { id: user.id },
      {
        language,
        title,
        epubBytes,
      },
    );
    if (created.kind === 'text') {
      const { text } = created;
      return json(
        {
          kind: 'text' as const,
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
          chapterCount: 1,
        },
        { status: 201, headers: rateLimitHeaders(requestLimit) },
      );
    }
    const { collection } = created;
    return json(
      {
        kind: 'collection' as const,
        collection: {
          id: collection.id,
          ownerId: collection.ownerId,
          language: collection.language,
          title: collection.title,
          kind: collection.kind,
          visibility: collection.visibility,
          createdAt: collection.createdAt,
        },
        textCount: created.texts.length,
        // First chapter's text id (texts are in spine/position order) so an API
        // client can open the reader on chapter 1 instead of the chapter list.
        firstTextId: created.texts[0]?.id ?? null,
      },
      { status: 201, headers: rateLimitHeaders(requestLimit) },
    );
  } catch (err) {
    if (err instanceof RequestRateLimitError) {
      return json(
        {
          error: 'rate_limited',
          message: 'Daily EPUB upload limit reached. Try again tomorrow.',
          limit: err.limit,
          retryAfterSeconds: err.retryAfterSeconds,
        },
        { status: 429, headers: rateLimitHeaders(err) },
      );
    }
    if (err instanceof TextValidationError) throw error(err.status, err.message);
    if (err instanceof EpubParseError) throw error(400, err.message);
    throw err;
  }
};
