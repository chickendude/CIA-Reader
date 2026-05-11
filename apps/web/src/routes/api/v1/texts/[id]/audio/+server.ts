/**
 * GET + POST /api/v1/texts/:id/audio (T-9.1).
 *
 * GET — list audio files attached to the text. canReadText gate.
 * POST — multipart upload of a single audio blob.
 */
import { error, json } from '@sveltejs/kit';

import { requireVerifiedUser } from '$lib/server/auth/require-user.js';
import {
  consumeRateLimit,
  rateLimitHeaders,
  RequestRateLimitError,
} from '$lib/server/auth/rate-limits.js';
import {
  AudioError,
  listAudioForText,
  uploadAudio,
} from '$lib/server/audio/audio.js';
import { canReadText } from '$lib/server/auth/can-read.js';
import { getReadableText } from '$lib/server/texts/upload.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// T-11.2: per-day cap on audio uploads (the per-file size cap lives
// in `MAX_AUDIO_BYTES`, enforced inside `uploadAudio`). 20/day is
// generous for chapter-by-chapter narration uploads while keeping
// storage growth and worker queue depth bounded.
const AUDIO_UPLOADS_PER_DAY = 20;
const AUDIO_WINDOW_MS = 24 * 60 * 60 * 1_000;

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
  const user = await requireVerifiedUser(event);
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
  // T-9.7: redistribution-rights checkbox. Form fields can come
  // through as 'on' (checked checkbox), 'true', or '1'.
  const ackRaw = form.get('acknowledgedRedistribution');
  const acknowledgedRedistribution =
    ackRaw === 'on' || ackRaw === 'true' || ackRaw === '1';
  try {
    const requestLimit = await consumeRateLimit(event, user.id, {
      scope: 'audio:upload',
      limit: AUDIO_UPLOADS_PER_DAY,
      windowMs: AUDIO_WINDOW_MS,
    });
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
      acknowledgedRedistribution,
    });
    return json(
      { audio },
      { status: 201, headers: rateLimitHeaders(requestLimit) },
    );
  } catch (e) {
    if (e instanceof RequestRateLimitError) {
      return json(
        {
          error: 'rate_limited',
          message: 'Daily audio upload limit reached. Try again tomorrow.',
          limit: e.limit,
          retryAfterSeconds: e.retryAfterSeconds,
        },
        { status: 429, headers: rateLimitHeaders(e) },
      );
    }
    if (e instanceof AudioError) throw error(e.status, e.message);
    throw e;
  }
};
