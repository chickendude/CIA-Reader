/**
 * Reader loader (T-5.1).
 *
 * URL contract: `/reader/[textId]?chapter=N&token=M`. The loader
 * resolves the text via the central `getReadableText` helper (owner
 * OR official visibility), clamps the requested chapter to the valid
 * range, and returns the chapter list + the active anchor.
 *
 * The render side (the three layout modes — `page`, `paged-scroll`,
 * `continuous`) lives in the components under `lib/components/reader/`
 * and shares the same data shape regardless of mode. Token-level
 * rendering, the word pop-up, and known-words tracking are layered on
 * in T-5.2 / T-5.4 / T-5.5; T-5.1 just stands the skeleton up so
 * those tickets have a real route to plug into.
 *
 * Auth is open: anonymous viewers can read official texts without
 * signing in (T-7.6's marketing surface). `isOwner` distinguishes the
 * owner — only owners poll status (T-4.4) and only owners get
 * known-words affordances (T-5.5).
 */
import { error } from '@sveltejs/kit';

import { getReadableText } from '$lib/server/texts/upload.js';
import type { PageServerLoad } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ReaderLayoutMode = 'page' | 'paged_scroll' | 'continuous';

function readInt(url: URL, key: string, fallback: number): number {
  const raw = url.searchParams.get(key);
  if (raw == null || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function readMode(
  url: URL,
  fallback: ReaderLayoutMode,
): ReaderLayoutMode {
  const raw = url.searchParams.get('mode');
  if (
    raw === 'page' ||
    raw === 'paged_scroll' ||
    raw === 'continuous'
  ) {
    return raw;
  }
  return fallback;
}

export const load: PageServerLoad = async ({ params, locals, url }) => {
  if (!UUID_RE.test(params.textId)) throw error(400, 'Invalid text id');
  const viewer = locals.user ? { id: locals.user.id } : null;
  const result = await getReadableText(viewer, params.textId);
  if (!result) throw error(404, 'Text not found');

  // Clamp anchor params to valid ranges. A bad `?chapter=999` URL
  // shouldn't 500 — it should land on the first chapter.
  const requestedChapter = readInt(url, 'chapter', 0);
  const chapterIdx = Math.max(
    0,
    Math.min(requestedChapter, result.chapters.length - 1),
  );
  const tokenIdx = Math.max(0, readInt(url, 'token', 0));

  // Mode preference: URL > user pref > default. user_languages.reader_layout_mode
  // is per-user/per-language; the per-user pref read lands when M5
  // wires user-pref persistence (T-5.1b). For the skeleton the URL is
  // the only source.
  const mode = readMode(url, 'continuous');

  return {
    text: {
      id: result.text.id,
      title: result.text.title,
      language: result.text.language,
      sourceType: result.text.sourceType,
      status: result.text.status,
      statusError: result.text.statusError,
      visibility: result.text.visibility,
      createdAt: result.text.createdAt,
    },
    chapters: result.chapters.map((c) => ({
      id: c.id,
      idx: c.idx,
      title: c.title,
      body: c.body,
      tokenCount: c.tokenCount,
    })),
    anchor: {
      chapterIdx,
      tokenIdx,
    },
    mode,
    isOwner: Boolean(locals.user && locals.user.id === result.text.ownerId),
  };
};
