import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { requireUser } from '$lib/server/auth/require-user.js';
import { upsertUserLanguage } from '$lib/server/profile.js';
import {
  LANGUAGES,
  SUPPORTED_LANGUAGE_CODES,
  isSupportedLanguage,
} from '@ciareader/shared-types';
import { parseJson } from '../../../auth/_helpers.js';
import type { RequestHandler } from './$types';

const patchSchema = z
  .object({
    scriptPreference: z.enum(['native', 'native_with_romanization', 'romanization_only']),
    romanizationScheme: z.enum(['iso15919', 'iast', 'hunterian', 'itrans']),
  })
  .partial()
  .refine(
    (v) => v.scriptPreference !== undefined || v.romanizationScheme !== undefined,
    {
      message: 'At least one field must be provided',
    },
  );

export const PATCH: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const code = event.params.code ?? '';
  if (!isSupportedLanguage(code)) {
    throw error(
      400,
      `Unsupported language '${code}'. Supported: ${SUPPORTED_LANGUAGE_CODES.join(', ')}`,
    );
  }
  const patch = await parseJson(event.request, patchSchema);
  if (patch.romanizationScheme) {
    const allowed = LANGUAGES[code].supportedRomanizations;
    if (!(allowed as readonly string[]).includes(patch.romanizationScheme)) {
      throw error(
        400,
        `Romanization '${patch.romanizationScheme}' is not supported for ${code}. Allowed: ${allowed.join(', ')}`,
      );
    }
  }
  const row = await upsertUserLanguage(user.id, code, patch);
  return json({ language: row });
};
