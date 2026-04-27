/**
 * Text upload form (T-4.1).
 *
 * Browser side renders a paste box + a file drop-zone shell. `.txt`
 * file content is read on the client and dropped into the textarea
 * (small, inline ingest); `.epub` and large `.txt` chunking land in
 * T-4.2 / T-4.3 — the dropzone surfaces a "coming soon" message for
 * those file types so we don't quietly drop user data.
 *
 * The server action calls the same `createPastedText` service the JSON
 * API uses, so validation + visibility defaults are identical between
 * web form and programmatic client. On success we 303 to
 * `/texts/[id]`, which is a placeholder reader for now (M5 builds the
 * real one).
 */
import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';

import {
  createPastedText,
  createTxtText,
  TextValidationError,
  MAX_PASTE_BYTES,
  MAX_TXT_BYTES,
  MAX_TITLE_LEN,
} from '$lib/server/texts/upload.js';
import { LANGUAGES, SUPPORTED_LANGUAGE_CODES } from '@ciareader/shared-types';
import type { Actions, PageServerLoad } from './$types';

// Source-type-aware schemas: paste keeps the tight 1MB cap, txt
// allows up to 10MB. The body field comes from the same `<textarea>`
// either way — the only difference is which service runs and which
// cap applies.
const pasteFormSchema = z.object({
  sourceType: z.literal('paste').optional(),
  language: z.enum(['hi', 'mr', 'or']),
  title: z.string().min(1).max(MAX_TITLE_LEN),
  body: z.string().min(1).max(MAX_PASTE_BYTES),
});

const txtFormSchema = z.object({
  sourceType: z.literal('txt'),
  language: z.enum(['hi', 'mr', 'or']),
  title: z.string().min(1).max(MAX_TITLE_LEN),
  body: z.string().min(1).max(MAX_TXT_BYTES),
});

const formSchema = z.union([txtFormSchema, pasteFormSchema]);

export const load: PageServerLoad = async ({ locals, url }) => {
  if (!locals.user) {
    throw redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
  }
  return {
    languages: SUPPORTED_LANGUAGE_CODES.map((code) => ({
      code,
      displayName: LANGUAGES[code].displayName,
      nativeName: LANGUAGES[code].nativeName,
    })),
    limits: {
      maxTitleLength: MAX_TITLE_LEN,
      // The browser uses the paste cap by default and bumps to the
      // txt cap when a file has been dropped. Both numbers are
      // surfaced so the live byte counter can swap thresholds without
      // a server round-trip.
      maxPasteBytes: MAX_PASTE_BYTES,
      maxTxtBytes: MAX_TXT_BYTES,
    },
  };
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    if (!locals.user) {
      throw redirect(303, '/login?next=/upload');
    }
    const fd = await request.formData();
    const sourceType = fd.get('sourceType')?.toString() === 'txt' ? 'txt' : 'paste';
    const raw = {
      sourceType,
      language: fd.get('language')?.toString() ?? '',
      title: fd.get('title')?.toString() ?? '',
      body: fd.get('body')?.toString() ?? '',
    };
    const parsed = formSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(400, {
        ok: false,
        message: parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
        // Echo the raw values back so the user doesn't lose their paste
        // on a validation error.
        values: raw,
      });
    }
    try {
      const created =
        parsed.data.sourceType === 'txt'
          ? await createTxtText(
              { id: locals.user.id },
              {
                language: parsed.data.language,
                title: parsed.data.title,
                body: parsed.data.body,
              },
            )
          : await createPastedText(
              { id: locals.user.id },
              {
                language: parsed.data.language,
                title: parsed.data.title,
                body: parsed.data.body,
              },
            );
      throw redirect(303, `/texts/${created.text.id}`);
    } catch (err) {
      if (err instanceof TextValidationError) {
        return fail(err.status, {
          ok: false,
          message: err.message,
          values: raw,
        });
      }
      throw err;
    }
  },
};
