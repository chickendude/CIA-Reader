/**
 * POST /api/v1/texts (T-4.1, extended T-4.2).
 *
 * Create a text from either a paste or a `.txt` upload. The web UI
 * hits this via the form action; mobile / API clients call it
 * directly with a bearer token. Both paths land on the same service
 * functions (`createPastedText` / `createTxtText`), so validation,
 * chunking, and visibility defaults are identical between web and
 * programmatic clients.
 *
 * EPUB ingest lands in T-4.3 with its own discriminator value.
 *
 * Response: 201 with the freshly created `text` metadata only — chapter
 * content is NOT echoed back to keep the create response small. Use the
 * read endpoint (or `/texts/:id`) to fetch chapters.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser, requireVerifiedUser } from '$lib/server/auth/require-user.js';
import {
  consumeRateLimit,
  rateLimitHeaders,
  RequestRateLimitError,
} from '$lib/server/auth/rate-limits.js';
import {
  createPastedText,
  createTxtText,
  TextValidationError,
  MAX_PASTE_BYTES,
  MAX_TXT_BYTES,
  MAX_TITLE_LEN,
} from '$lib/server/texts/upload.js';
import {
  listOfficialTexts,
  listOwnedTexts,
  listSharedTexts,
} from '$lib/server/texts/library.js';
import type { RequestHandler } from './$types';
import { parseJson } from '../auth/_helpers.js';
import { SUPPORTED_LANGUAGE_CODES, type LanguageCode } from '@ciareader/shared-types';

// T-11.2: per-day cap on text uploads. 50/day is generous for an
// engaged learner uploading a chapter at a time and trips long
// before a runaway script floods the chunker. Window is exactly
// 24h so a user who uploads at 11pm doesn't get throttled at 1am
// of the next calendar day.
const UPLOADS_PER_DAY = 50;
const UPLOAD_WINDOW_MS = 24 * 60 * 60 * 1_000;

// One discriminated schema per source type — paste's body cap is
// stricter than .txt's, and the error message users see should reflect
// the path they took.
const pasteSchema = z.object({
  sourceType: z.literal('paste').optional(),
  language: z.enum(SUPPORTED_LANGUAGE_CODES as readonly [LanguageCode, ...LanguageCode[]]),
  title: z.string().min(1).max(MAX_TITLE_LEN),
  body: z.string().min(1).max(MAX_PASTE_BYTES),
});

const txtSchema = z.object({
  sourceType: z.literal('txt'),
  language: z.enum(SUPPORTED_LANGUAGE_CODES as readonly [LanguageCode, ...LanguageCode[]]),
  title: z.string().min(1).max(MAX_TITLE_LEN),
  body: z.string().min(1).max(MAX_TXT_BYTES),
});

const body = z.union([txtSchema, pasteSchema]);

export const POST: RequestHandler = async (event) => {
  const user = await requireVerifiedUser(event);
  const input = await parseJson(event.request, body);
  try {
    const requestLimit = await consumeRateLimit(event, user.id, {
      scope: 'texts:create',
      limit: UPLOADS_PER_DAY,
      windowMs: UPLOAD_WINDOW_MS,
    });
    const created =
      input.sourceType === 'txt'
        ? await createTxtText(
            { id: user.id },
            {
              language: input.language,
              title: input.title,
              body: input.body,
            },
          )
        : await createPastedText(
            { id: user.id },
            {
              language: input.language,
              title: input.title,
              body: input.body,
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
      { status: 201, headers: rateLimitHeaders(requestLimit) },
    );
  } catch (err) {
    if (err instanceof RequestRateLimitError) {
      return json(
        {
          error: 'rate_limited',
          message: 'Daily text upload limit reached. Try again tomorrow.',
          limit: err.limit,
          retryAfterSeconds: err.retryAfterSeconds,
        },
        { status: 429, headers: rateLimitHeaders(err) },
      );
    }
    if (err instanceof TextValidationError) throw error(err.status, err.message);
    throw err;
  }
};

// GET /api/v1/texts — list library texts for a Bearer/API client.
//
// The web library reads the active language from the layout's
// current-language cookie; a mobile client sends no cookie, so language
// is an explicit query param here. `scope` selects the library tab:
//   - owned    — the caller's own imports (auth required)
//   - shared   — texts shared with the caller (auth required)
//   - official — the public official library (no auth required)
// Pagination magnitude is clamped by the service (clampPage).
const listQuerySchema = z.object({
  scope: z.enum(['owned', 'shared', 'official']).default('owned'),
  language: z
    .enum(SUPPORTED_LANGUAGE_CODES as readonly [LanguageCode, ...LanguageCode[]])
    .optional(),
  limit: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

export const GET: RequestHandler = async (event) => {
  const parsed = listQuerySchema.safeParse({
    scope: event.url.searchParams.get('scope') ?? undefined,
    language: event.url.searchParams.get('language') ?? undefined,
    limit: event.url.searchParams.get('limit') ?? undefined,
    offset: event.url.searchParams.get('offset') ?? undefined,
  });
  if (!parsed.success) {
    throw error(
      400,
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }
  const { scope, language, limit, offset } = parsed.data;
  const opts = { limit, offset, language };

  if (scope === 'official') {
    return json(await listOfficialTexts(opts));
  }
  const user = await requireUser(event);
  const page =
    scope === 'owned'
      ? await listOwnedTexts({ id: user.id }, opts)
      : await listSharedTexts({ id: user.id }, opts);
  return json(page);
};
