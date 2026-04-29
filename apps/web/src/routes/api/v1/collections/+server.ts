/**
 * POST /api/v1/collections (T-8.1).
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireUser } from '$lib/server/auth/require-user.js';
import { CollectionError, createCollection } from '$lib/server/collections.js';
import { isSupportedLanguage } from '@ciareader/shared-types';
import type { LanguageCode } from '@ciareader/shared-types';
import { parseJson } from '../auth/_helpers.js';
import type { RequestHandler } from './$types';

const bodySchema = z
  .object({
    language: z.string().refine(isSupportedLanguage, 'unsupported language'),
    title: z.string().min(1).max(200),
    kind: z.enum(['chapter_book', 'course', 'anthology']).optional(),
    description: z.string().max(2000).nullable().optional(),
    coverUrl: z.string().url().max(500).nullable().optional(),
  })
  .strict();

export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const body = await parseJson(event.request, bodySchema);
  try {
    const collection = await createCollection({
      ownerId: user.id,
      language: body.language as LanguageCode,
      kind: body.kind,
      title: body.title,
      description: body.description ?? null,
      coverUrl: body.coverUrl ?? null,
    });
    return json({ collection }, { status: 201 });
  } catch (e) {
    if (e instanceof CollectionError) throw error(e.status, e.message);
    throw e;
  }
};
