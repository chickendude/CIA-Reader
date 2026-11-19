/**
 * Fetch chapter text, words and phrase matches as the reader needs them. Apply the same access
 * checks as the reader page.
 */
import { error, json } from '@sveltejs/kit';

import { resolveUser } from '$lib/server/auth/require-user.js';
import { getReadableText } from '$lib/server/texts/upload.js';
import { loadChapterTokens } from '$lib/server/texts/tokens.js';
import { loadChapterPhraseSpans } from '$lib/server/texts/phrase-spans.js';
import { getPdfStorage } from '$lib/server/pdf/storage.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET: RequestHandler = async (event) => {
  const textId = event.params.id;
  if (!textId || !UUID_RE.test(textId)) throw error(400, 'Invalid text id');
  const idxRaw = event.params.idx;
  if (!idxRaw) throw error(400, 'Invalid chapter index');
  const idx = Number.parseInt(idxRaw, 10);
  if (!Number.isFinite(idx) || idx < 0) throw error(400, 'Invalid chapter index');

  // resolveUser (not locals.user) so Bearer-authenticated API clients — the
  // Android reader — are recognized, not just cookie sessions. Without it an
  // app client reads as anonymous and 404s on its own private texts.
  const viewer = await resolveUser(event);
  const result = await getReadableText(viewer ? { id: viewer.id } : null, textId);
  if (!result) throw error(404, 'Text not found');
  const chapter = result.chapters.find((c) => c.idx === idx);
  if (!chapter) throw error(404, 'Chapter not found');

  const tokens = await loadChapterTokens(chapter.id, viewer?.id ?? null, textId);
  // Return null while the words are still being processed. No phrase matches gives an empty list.
  const phraseSpans = tokens
    ? await loadChapterPhraseSpans(chapter.id, viewer?.id ?? null)
    : null;
  // PDF (image) chapters carry a page image; the app renders it with the
  // per-token bbox already on `tokens` as a tappable overlay. Null for
  // text-source chapters.
  const pageImageUrl = chapter.pageImageKey
    ? getPdfStorage().urlFor(chapter.pageImageKey)
    : null;
  return json({
    chapterId: chapter.id,
    chapterIdx: chapter.idx,
    body: chapter.body,
    tokens,
    phraseSpans,
    pageImageUrl,
    pageWidth: chapter.pageWidth ?? null,
    pageHeight: chapter.pageHeight ?? null,
  });
};
