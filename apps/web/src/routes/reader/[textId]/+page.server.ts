/**
 * Load the active chapter for the current viewer. Other chapters can be loaded when the reader
 * opens them.
 */
import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';

import { canEditDictionary, isCuratorOrAdmin } from '$lib/server/dictionary/permissions';
import { getReadableText } from '$lib/server/texts/upload.js';
import { getPdfStorage } from '$lib/server/pdf/storage.js';
import { loadChapterTokens, type RenderedToken } from '$lib/server/texts/tokens.js';
import { loadChapterPhraseSpans } from '$lib/server/texts/phrase-spans.js';
import { getTextProgress } from '$lib/server/texts/progress.js';
import { readerCollectionContext } from '$lib/server/collections.js';
import { listAudioForText } from '$lib/server/audio/audio.js';
import { db, schema } from '$lib/server/db/index.js';
import type { LanguageCode } from '@ciareader/shared-types';
import {
  DEFAULT_READER_SETTINGS,
  type ReaderSettings,
} from '$lib/components/reader/reader-settings.js';
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

function readBool(url: URL, key: string): boolean {
  const raw = url.searchParams.get(key);
  return raw === '1' || raw === 'true';
}

function packTokens(tokens: RenderedToken[]) {
  // SvelteKit transmits a shared object once. Repeated words and spaces can share their
  // dictionary data while each occurrence keeps its own ID and original token index.
  const readings = new Map<string, Omit<RenderedToken, 'id' | 'idx'>>();
  return tokens.map(({ id, idx, ...reading }) => {
    const key = JSON.stringify(reading);
    const shared = readings.get(key) ?? reading;
    if (shared === reading) readings.set(key, reading);
    return [id, idx, shared] as const;
  });
}

export const load: PageServerLoad = async ({ params, locals, url }) => {
  if (!UUID_RE.test(params.textId)) throw error(400, 'Invalid text id');
  const viewer = locals.user ? { id: locals.user.id } : null;
  const result = await getReadableText(viewer, params.textId);
  if (!result) throw error(404, 'Text not found');

  // An explicit location in the URL takes priority over the saved reading position.
  let savedProgress: Awaited<ReturnType<typeof getTextProgress>> = null;
  if (locals.user) {
    savedProgress = await getTextProgress(locals.user.id, params.textId);
  }
  // `?endOfChapter=1` is the cross-text "prev" handoff: when a
  // reader on page 1 of chapter N hits prev, they advance into the
  // previous text's LAST page (last page of the last internal
  // chapter). We treat this as a URL anchor so saved progress
  // doesn't override it.
  const endOfChapter = url.searchParams.get('endOfChapter') === '1';
  const hasUrlAnchor =
    url.searchParams.has('chapter') ||
    url.searchParams.has('token') ||
    endOfChapter;

  // Clamp anchor params to valid ranges. A bad `?chapter=999` URL
  // shouldn't 500 — it should land on the first chapter.
  const defaultChapter = endOfChapter
    ? result.chapters.length - 1
    : !hasUrlAnchor && savedProgress ? savedProgress.lastChapterIdx : 0;
  const requestedChapter = readInt(url, 'chapter', defaultChapter);
  const chapterIdx = Math.max(
    0,
    Math.min(requestedChapter, result.chapters.length - 1),
  );
  const tokenIdx = Math.max(
    0,
    readInt(
      url,
      'token',
      !hasUrlAnchor && savedProgress ? savedProgress.lastTokenIdx : 0,
    ),
  );

  // Per-language reader settings are persisted in
  // user_languages. Anonymous viewers don't have a row, so they get
  // the defaults. Owners + signed-in readers get their saved popover
  // values; the popover writes through PATCH /api/v1/me/languages/:code.
  let readerSettings: ReaderSettings = { ...DEFAULT_READER_SETTINGS };
  if (locals.user) {
    const lang = result.text.language as LanguageCode;
    const [row] = await db
      .select()
      .from(schema.userLanguages)
      .where(
        and(
          eq(schema.userLanguages.userId, locals.user.id),
          eq(schema.userLanguages.language, lang),
        ),
      )
      .limit(1);
    if (row) {
      readerSettings = {
        readerLayoutMode: row.readerLayoutMode,
        wordsPerPage: row.wordsPerPage,
        fontFamily: row.fontFamily,
        fontSize: row.fontSize,
        lineSpacing: row.lineSpacing,
        highlightStyle: row.highlightStyle,
        highlightLearning: row.highlightLearning,
        readingWidth: row.readingWidth,
        scriptPreference: row.scriptPreference,
        romanizationScheme: row.romanizationScheme,
      };
    }
  }

  // Mode preference: URL > user pref > default. URL still wins so a
  // shareable `?mode=page` link works regardless of the recipient's
  // saved preference. Romanization toggle: URL > scriptPreference.
  const mode = readMode(url, readerSettings.readerLayoutMode);
  const showRomanization = url.searchParams.has('roman')
    ? readBool(url, 'roman')
    : readerSettings.scriptPreference !== 'native';

  // Send only the current chapter's text and words on the first load so opening a large book
  // stays fast.
  const viewerId = locals.user?.id ?? null;
  const activeChapter = result.chapters[chapterIdx];
  const activeTokens = activeChapter
    ? await loadChapterTokens(activeChapter.id, viewerId, params.textId)
    : null;
  // An empty list means the chapter has been processed and has no phrase matches. Null means
  // processing has not finished.
  const activeChapterSpans = activeChapter && activeTokens
    ? await loadChapterPhraseSpans(activeChapter.id, viewerId)
    : null;

  // if this text is a member of a collection, surface the
  // collection title + prev / next text ids in the reader chrome.
  // Picks one collection deterministically when the text is in
  // multiple (collections.updatedAt DESC).
  const collectionContext = await readerCollectionContext(params.textId);

  // Pull audio attached to the text. Prefer chapter-specific
  // audio when present; fall back to whole-text audio otherwise.
  // The player only renders when a track exists.
  const allAudio = await listAudioForText(params.textId);
  const audioForChapter = activeChapter
    ? allAudio.find((a) => a.chapterId === activeChapter.id) ?? null
    : null;
  const audioForText = allAudio.find((a) => a.chapterId === null) ?? null;
  const activeAudio = audioForChapter ?? audioForText;

  // PDF page images: cheap to resolve a URL per chapter (just a key →
  // path), so include it for every page so the image reader can show a
  // page indicator + navigate. Tokens/body still ship active-only.
  const pdfStorage = getPdfStorage();

  // course-kind collections gate "next" until the active
  // text is finished (pctRead >= 100). The reader UI grays out the
  // next link unless ?skipLock=1 is set on the URL — a deliberate
  // escape hatch for self-paced learners who want to skip ahead.
  const COURSE_COMPLETION_THRESHOLD = 100;
  let nextLocked = false;
  if (
    collectionContext &&
    collectionContext.collection.kind === 'course' &&
    collectionContext.nextTextId
  ) {
    const pct = savedProgress?.pctRead ?? 0;
    nextLocked = pct < COURSE_COMPLETION_THRESHOLD;
  }

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
      body: c.idx === chapterIdx ? c.body : null,
      tokenCount: c.tokenCount,
      // Only the active chapter ships with server-rendered tokens.
      // Siblings carry `tokens: null`; the lazy endpoint returns both
      // body and tokens when a sibling needs to render.
      tokens: c.idx === chapterIdx && activeTokens ? packTokens(activeTokens) : null,
      phraseSpans: c.idx === chapterIdx ? activeChapterSpans : null,
      // PDF page image (all pages — cheap URL). Null for non-PDF / pages
      // not yet processed.
      pageImageUrl: c.pageImageKey ? pdfStorage.urlFor(c.pageImageKey) : null,
      pageWidth: c.pageWidth,
      pageHeight: c.pageHeight,
    })),
    anchor: {
      chapterIdx,
      tokenIdx,
      endOfChapter,
    },
    mode,
    showRomanization,
    readerSettings,
    // Persist the popover's per-language state for any signed-in
    // reader; anonymous viewers (anon reads of an official text) get
    // a session-only live preview.
    canReviewHindi: result.text.language === 'hi' && isCuratorOrAdmin(locals.user)
      && (result.text.visibility === 'official' || result.text.ownerId === locals.user?.id),
    canPersistSettings: locals.user != null,
    dictionaryEditor: await canEditDictionary(locals.user, result.text.language),
    isOwner: Boolean(locals.user && locals.user.id === result.text.ownerId),
    // Surface admin status so the reader chrome can offer the
    // reprocess affordance to admins on any text (owners get the
    // existing per-text controls; reprocess is admin-only because it
    // re-runs NLP and overwrites token rows). Curators don't get it
    // — they can edit the dictionary, not rerun pipelines.
    isAdmin: locals.user?.role === 'admin',
    collectionContext: collectionContext
      ? {
          collectionId: collectionContext.collection.id,
          collectionTitle: collectionContext.collection.title,
          collectionKind: collectionContext.collection.kind,
          position: collectionContext.position,
          totalCount: collectionContext.totalCount,
          prevTextId: collectionContext.prevTextId,
          nextTextId: collectionContext.nextTextId,
          // Keep the chapter list for navigation and whole-book progress.
          chapters: collectionContext.chapters,
          // course-kind gate. UI flips the next link to a
          // disabled state with a tooltip; ?skipLock=1 overrides.
          nextLocked,
        }
      : null,
    audio: activeAudio
      ? {
          id: activeAudio.id,
          url: activeAudio.url,
          mime: activeAudio.mime,
          durationMs: activeAudio.durationMs,
          attribution: activeAudio.attribution,
          license: activeAudio.license,
        }
      : null,
  };
};
