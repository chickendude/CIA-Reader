/**
 * POST /api/v1/texts/:id/pages/:idx
 *
 * Ingest one rasterized PDF page. Multipart body:
 *   - image:        the rendered page (WebP/JPEG/PNG)
 *   - width/height: the rendered image's pixel dimensions
 *   - bornDigital:  (optional) JSON {items:[…]} extracted from the PDF's
 *                   text layer; when present, OCR is skipped server-side
 *   - engine:       (optional) 'vision' | 'vision_llm'
 *
 * Owner-or-admin only. Stores the image, OCRs the page, persists tokens,
 * and flips the text to `ready` once the last page lands.
 */
import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';

import { requireVerifiedUser } from '$lib/server/auth/require-user.js';
import { db, schema } from '$lib/server/db/index.js';
import {
  isAllowedPageImageMime,
  MAX_PAGE_IMAGE_BYTES,
} from '$lib/server/pdf/storage.js';
import { PdfPageError, processPdfPage } from '$lib/server/texts/pdf-page.js';
import type { BornDigitalPayload } from '$lib/server/nlp-client.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST: RequestHandler = async (event) => {
  const user = await requireVerifiedUser(event);
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid text id');
  const idx = Number.parseInt(event.params.idx ?? '', 10);
  if (!Number.isInteger(idx) || idx < 0) throw error(400, 'Invalid page index');

  // Owner-or-admin gate (don't leak existence to others).
  const [text] = (await db
    .select({ ownerId: schema.texts.ownerId })
    .from(schema.texts)
    .where(eq(schema.texts.id, id))
    .limit(1)) as Array<{ ownerId: string | null }>;
  if (!text) throw error(404, 'Text not found');
  if (user.role !== 'admin' && text.ownerId !== user.id) {
    throw error(404, 'Text not found');
  }

  const form = await event.request.formData();
  const file = form.get('image');
  if (!(file instanceof File)) throw error(400, 'image field required');
  const mime = file.type || 'image/webp';
  if (!isAllowedPageImageMime(mime)) {
    throw error(415, `Unsupported image type ${mime}`);
  }
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf.byteLength > MAX_PAGE_IMAGE_BYTES) {
    throw error(413, 'Page image too large');
  }

  const width = Number.parseInt(String(form.get('width') ?? ''), 10);
  const height = Number.parseInt(String(form.get('height') ?? ''), 10);
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw error(400, 'width and height are required');
  }

  const engine =
    form.get('engine') === 'vision_llm' ? 'vision_llm' : 'vision';

  let bornDigital: BornDigitalPayload | null = null;
  const bd = form.get('bornDigital');
  if (typeof bd === 'string' && bd) {
    try {
      bornDigital = JSON.parse(bd) as BornDigitalPayload;
    } catch {
      throw error(400, 'invalid bornDigital JSON');
    }
  }

  try {
    const result = await processPdfPage({
      textId: id,
      idx,
      imageBytes: buf,
      mime,
      width,
      height,
      engine,
      bornDigital,
    });
    return json(
      {
        chapterId: result.chapterId,
        tokenCount: result.tokenCount,
        complete: result.complete,
      },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof PdfPageError) throw error(e.status, e.message);
    throw e;
  }
};
