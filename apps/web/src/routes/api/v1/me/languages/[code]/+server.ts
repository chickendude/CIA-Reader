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
    // T-5.1b reader-popover fields. All optional; the popover sends
    // a partial diff against the loader-provided baseline so we
    // don't keep rewriting columns the user didn't touch.
    readerLayoutMode: z.enum(['page', 'paged_scroll', 'continuous']),
    wordsPerPage: z.number().int().min(50).max(1000),
    fontFamily: z.string().min(1).max(80).nullable(),
    fontSize: z.number().min(14).max(28),
    lineSpacing: z.number().min(1.2).max(2.2),
    highlightStyle: z.enum(['underline', 'background', 'colored_text']),
    readingWidth: z.enum(['narrow', 'medium', 'wide']),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field must be provided',
  });

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
