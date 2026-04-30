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
import { and, eq } from 'drizzle-orm';

import { getReadableText } from '$lib/server/texts/upload.js';
import { loadChapterTokens } from '$lib/server/texts/tokens.js';
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

export const load: PageServerLoad = async ({ params, locals, url }) => {
  if (!UUID_RE.test(params.textId)) throw error(400, 'Invalid text id');
  const viewer = locals.user ? { id: locals.user.id } : null;
  const result = await getReadableText(viewer, params.textId);
  if (!result) throw error(404, 'Text not found');

  // Resume from saved progress when the URL has no anchor of its
  // own. T-5.6: a returning reader who clicks the library card
  // should land where they left off, not at chapter 0.
  let savedProgress: Awaited<ReturnType<typeof getTextProgress>> = null;
  if (locals.user) {
    savedProgress = await getTextProgress(locals.user.id, params.textId);
  }
  const hasUrlAnchor =
    url.searchParams.has('chapter') || url.searchParams.has('token');

  // Clamp anchor params to valid ranges. A bad `?chapter=999` URL
  // shouldn't 500 — it should land on the first chapter.
  const requestedChapter = readInt(
    url,
    'chapter',
    !hasUrlAnchor && savedProgress ? savedProgress.lastChapterIdx : 0,
  );
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

  // T-5.1b: per-language reader settings are persisted in
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

  // T-12.5: mobile payload audit. Only the active chapter ships its
  // body and tokens on first paint; sibling chapter bodies were the
  // remaining large field after T-5.1a made tokens lazy. Continuous
  // mode fetches body+tokens on demand from the chapter endpoint, and
  // page / scroll modes re-run this loader when the active chapter
  // changes.
  const viewerId = locals.user?.id ?? null;
  const activeChapter = result.chapters[chapterIdx];
  const activeTokens = activeChapter
    ? await loadChapterTokens(activeChapter.id, viewerId)
    : null;

  // T-8.3: if this text is a member of a collection, surface the
  // collection title + prev / next text ids in the reader chrome.
  // Picks one collection deterministically when the text is in
  // multiple (collections.updatedAt DESC).
  const collectionContext = await readerCollectionContext(params.textId);

  // T-9.1: pull audio attached to the text. Prefer chapter-specific
  // audio when present; fall back to whole-text audio otherwise.
  // The player only renders when a track exists.
  const allAudio = await listAudioForText(params.textId);
  const audioForChapter = activeChapter
    ? allAudio.find((a) => a.chapterId === activeChapter.id) ?? null
    : null;
  const audioForText = allAudio.find((a) => a.chapterId === null) ?? null;
  const activeAudio = audioForChapter ?? audioForText;

  // T-8.6: course-kind collections gate "next" until the active
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
      tokens: c.idx === chapterIdx ? activeTokens : null,
    })),
    anchor: {
      chapterIdx,
      tokenIdx,
    },
    mode,
    showRomanization,
    readerSettings,
    // Persist the popover's per-language state for any signed-in
    // reader; anonymous viewers (anon reads of an official text) get
    // a session-only live preview.
    canPersistSettings: locals.user != null,
    isOwner: Boolean(locals.user && locals.user.id === result.text.ownerId),
    // T-2.8: surface admin status so the reader chrome can offer the
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
          // T-8.6: course-kind gate. UI flips the next link to a
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
