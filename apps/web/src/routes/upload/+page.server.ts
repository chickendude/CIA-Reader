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
  createEpubText,
  createPastedText,
  createTxtText,
  EpubParseError,
  TextValidationError,
  MAX_EPUB_BYTES,
  MAX_PASTE_BYTES,
  MAX_TXT_BYTES,
  MAX_TITLE_LEN,
  MIN_TITLE_LEN,
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
      maxEpubBytes: MAX_EPUB_BYTES,
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

  epub: async ({ request, locals }) => {
    if (!locals.user) {
      throw redirect(303, '/login?next=/upload');
    }
    const fd = await request.formData();
    const language = fd.get('language')?.toString() ?? '';
    const titleRaw = fd.get('title')?.toString() ?? '';
    const file = fd.get('file');
    if (
      language !== 'hi' &&
      language !== 'mr' &&
      language !== 'or'
    ) {
      return fail(400, {
        ok: false,
        section: 'epub',
        message: `Unsupported language '${language}'`,
      });
    }
    if (!(file instanceof File)) {
      return fail(400, {
        ok: false,
        section: 'epub',
        message: 'Please select an .epub file to upload',
      });
    }
    if (file.size === 0) {
      return fail(400, {
        ok: false,
        section: 'epub',
        message: 'EPUB file is empty',
      });
    }
    if (file.size > MAX_EPUB_BYTES) {
      return fail(400, {
        ok: false,
        section: 'epub',
        message: `EPUB exceeds ${MAX_EPUB_BYTES.toLocaleString()} bytes`,
      });
    }
    let title = titleRaw.trim();
    if (title.length === 0) title = file.name.replace(/\.epub$/i, '').trim();
    if (title.length < MIN_TITLE_LEN) {
      return fail(400, {
        ok: false,
        section: 'epub',
        message: 'title is required',
      });
    }
    if (title.length > MAX_TITLE_LEN) {
      return fail(400, {
        ok: false,
        section: 'epub',
        message: `title exceeds ${MAX_TITLE_LEN} characters`,
      });
    }
    const epubBytes = new Uint8Array(await file.arrayBuffer());
    try {
      const created = await createEpubText(
        { id: locals.user.id },
        { language, title, epubBytes },
      );
      throw redirect(303, `/texts/${created.text.id}`);
    } catch (err) {
      if (err instanceof TextValidationError) {
        return fail(err.status, {
          ok: false,
          section: 'epub',
          message: err.message,
        });
      }
      if (err instanceof EpubParseError) {
        return fail(400, {
          ok: false,
          section: 'epub',
          message: err.message,
        });
      }
      throw err;
    }
  },
};
