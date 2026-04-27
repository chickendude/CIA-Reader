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

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  createPastedText,
  createTxtText,
  TextValidationError,
  MAX_PASTE_BYTES,
  MAX_TXT_BYTES,
  MAX_TITLE_LEN,
} from '$lib/server/texts/upload.js';
import type { RequestHandler } from './$types';
import { parseJson } from '../auth/_helpers.js';

// One discriminated schema per source type — paste's body cap is
// stricter than .txt's, and the error message users see should reflect
// the path they took.
const pasteSchema = z.object({
  sourceType: z.literal('paste').optional(),
  language: z.enum(['hi', 'mr', 'or']),
  title: z.string().min(1).max(MAX_TITLE_LEN),
  body: z.string().min(1).max(MAX_PASTE_BYTES),
});

const txtSchema = z.object({
  sourceType: z.literal('txt'),
  language: z.enum(['hi', 'mr', 'or']),
  title: z.string().min(1).max(MAX_TITLE_LEN),
  body: z.string().min(1).max(MAX_TXT_BYTES),
});

const body = z.union([txtSchema, pasteSchema]);

export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const input = await parseJson(event.request, body);
  try {
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
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof TextValidationError) throw error(err.status, err.message);
    throw err;
  }
};
