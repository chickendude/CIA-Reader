/**
 * GET + POST /api/v1/texts/:id/audio (T-9.1).
 *
 * GET — list audio files attached to the text. canReadText gate.
 * POST — multipart upload of a single audio blob.
 */
import { error, json } from '@sveltejs/kit';

import { requireUser } from '$lib/server/auth/require-user.js';
import {
  AudioError,
  listAudioForText,
  uploadAudio,
} from '$lib/server/audio/audio.js';
import { canReadText } from '$lib/server/auth/can-read.js';
import { getReadableText } from '$lib/server/texts/upload.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET: RequestHandler = async (event) => {
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid text id');
  const viewer = event.locals.user ? { id: event.locals.user.id } : null;
  // Visibility: anyone with read access can list. canReadText
  // already handles owner / official / shared. We hand it the
  // same shape as the reader does.
  const result = await getReadableText(viewer, id);
  if (!result) throw error(404, 'Text not found');
  if (!(await canReadText(viewer, result.text))) throw error(404, 'Text not found');
  const url = new URL(event.request.url);
  const chapterIdParam = url.searchParams.get('chapterId');
  const audio = await listAudioForText(id, chapterIdParam);
  return json({ audio });
};

export const POST: RequestHandler = async (event) => {
  const user = await requireUser(event);
  const id = event.params.id;
  if (!id || !UUID_RE.test(id)) throw error(400, 'Invalid text id');
  const form = await event.request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw error(400, 'file field required');
  const chapterId = form.get('chapterId');
  const attribution = form.get('attribution');
  const license = form.get('license');
  const durationRaw = form.get('durationMs');
  const durationMs =
    typeof durationRaw === 'string' && durationRaw
      ? Number.parseInt(durationRaw, 10)
      : null;
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    const audio = await uploadAudio({
      textId: id,
      chapterId:
        typeof chapterId === 'string' && chapterId ? chapterId : null,
      body: buf,
      mime: file.type || 'audio/mpeg',
      originalName: file.name || 'upload',
      attribution:
        typeof attribution === 'string' && attribution ? attribution : null,
      license:
        typeof license === 'string' && license ? license : null,
      durationMs:
        typeof durationMs === 'number' && Number.isFinite(durationMs)
          ? durationMs
          : null,
      uploader: { id: user.id, role: user.role },
    });
    return json({ audio }, { status: 201 });
  } catch (e) {
    if (e instanceof AudioError) throw error(e.status, e.message);
    throw e;
  }
};
