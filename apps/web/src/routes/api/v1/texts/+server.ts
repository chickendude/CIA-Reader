/**
 * POST /api/v1/texts (T-4.1).
 *
 * Create a pasted text. The web upload UI calls this through the
 * SvelteKit form action; mobile / API clients can hit it directly with
 * a bearer token. Both go through the same `createPastedText` service.
 *
 * `.txt` and `.epub` ingest land in T-4.2 / T-4.3 — until those ship,
 * `sourceType` is fixed to `'paste'` and the body must be supplied
 * inline. The schema allows the field for forward compatibility.
 *
 * Response: 201 with the freshly created `text` (sans body) so the
 * caller can navigate to `/texts/:id`. Chapter content is NOT echoed
 * back to keep the create response small — the read endpoint serves it.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  createPastedText,
  TextValidationError,
  MAX_PASTE_BYTES,
  MAX_TITLE_LEN,
} from '$lib/server/texts/upload.js';
import type { RequestHandler } from './$types';
import { parseJson } from '../auth/_helpers.js';

const body = z.object({
  language: z.enum(['hi', 'mr', 'or']),
  title: z.string().min(1).max(MAX_TITLE_LEN),
  // Validated again in the service for byte length; the cap here is a
  // cheap shot to reject obviously-too-large requests before we copy
  // the string.
  body: z.string().min(1).max(MAX_PASTE_BYTES),
  sourceType: z.literal('paste').optional(),
});

export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const input = await parseJson(event.request, body);
  try {
    const { text } = await createPastedText(
      { id: user.id },
      {
        language: input.language,
        title: input.title,
        body: input.body,
      },
    );
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
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof TextValidationError) throw error(err.status, err.message);
    throw err;
  }
};
