/**
 * Accept the EPUB as a file upload. A single chapter opens as a text. Multiple chapters form a
 * chapter book. The response's kind field tells the client which page to open.
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

// EPUB ingest is expensive (chunking + parsing + chapter
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
