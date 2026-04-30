// @vitest-environment node
/**
 * Tests for /reader/[textId] SSR loader (T-5.1).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MOBILE_RESPONSE_BUDGET_BYTES,
  jsonPayloadBytes,
} from '$lib/server/payload-budget.js';

const getReadableText = vi.fn();
const loadChapterTokens = vi.fn();
const loadChapterPhraseSpans = vi.fn();

vi.mock('$lib/server/texts/upload.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/texts/upload.js')>(
    '$lib/server/texts/upload.js',
  );
  return {
    ...actual,
    getReadableText: (...a: unknown[]) => getReadableText(...a),
    getOwnedText: (...a: unknown[]) => getReadableText(...a),
  };
});

vi.mock('$lib/server/texts/tokens.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/texts/tokens.js')>(
    '$lib/server/texts/tokens.js',
  );
  return {
    ...actual,
    loadChapterTokens: (...a: unknown[]) => loadChapterTokens(...a),
  };
});

// T-14.3: phrase spans ride alongside the active chapter. Default
// the loader to an empty array so existing tests stay focused on
// the chapter / token / progress surfaces.
vi.mock('$lib/server/texts/phrase-spans.js', async () => {
  const actual = await vi.importActual<
    typeof import('$lib/server/texts/phrase-spans.js')
  >('$lib/server/texts/phrase-spans.js');
  return {
    ...actual,
    loadChapterPhraseSpans: (...a: unknown[]) => loadChapterPhraseSpans(...a),
  };
});

const getTextProgress = vi.fn();
vi.mock('$lib/server/texts/progress.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/texts/progress.js')>(
    '$lib/server/texts/progress.js',
  );
  return {
    ...actual,
    getTextProgress: (...a: unknown[]) => getTextProgress(...a),
  };
});

// T-5.1b: the loader looks up user_languages directly. Mock the
// drizzle query chain to return whatever the test stages in
// `userLanguagesRow`.
let userLanguagesRow: Record<string, unknown> | null = null;
// T-8.3: the loader now calls readerCollectionContext. Mock to
// "no collection" so existing tests stay focused on the reader
// surface; tests that care can override.
vi.mock('$lib/server/collections.js', () => ({
  readerCollectionContext: async () => null,
}));

// T-9.1: the loader pulls audio for the active text + chapter.
// Default to "no audio" so existing tests don't have to care.
vi.mock('$lib/server/audio/audio.js', () => ({
  listAudioForText: async () => [],
}));

vi.mock('$lib/server/db/index.js', () => {
  type ChainShape = {
    from: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
  };
  const chain: ChainShape = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => (userLanguagesRow ? [userLanguagesRow] : [])),
  };
  return {
    db: { select: vi.fn(() => chain) },
    schema: {
      userLanguages: {
        userId: 'ul.user_id',
        language: 'ul.language',
      },
    },
  };
});

type LoadFn = (typeof import('./+page.server.js'))['load'];

const VALID_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
type TestUser = { id: string; role: 'user' | 'curator' | 'admin' };
const USER: TestUser = { id: 'user-1', role: 'user' };

async function callLoad(
  url: string,
  textId = VALID_ID,
  user: TestUser | null = USER,
) {
  const { load } = await import('./+page.server.js');
  const event = {
    params: { textId },
    locals: { user },
    url: new URL(url),
  } as unknown as Parameters<LoadFn>[0];
  try {
    return await load(event);
  } catch (e) {
    return e as { status: number; location?: string };
  }
}

function ownedTextWithChapters(n: number) {
  return {
    text: {
      id: VALID_ID,
      ownerId: USER.id,
      title: 'Sample',
      language: 'hi',
      sourceType: 'paste',
      status: 'ready',
      statusError: null,
      visibility: 'private',
      createdAt: new Date(),
    },
    chapters: Array.from({ length: n }, (_, i) => ({
      id: `c${i}`,
      idx: i,
      title: null,
      body: 'पाठ',
      tokenCount: 1,
    })),
  };
}

beforeEach(() => {
  getReadableText.mockReset();
  loadChapterTokens.mockReset();
  loadChapterPhraseSpans.mockReset();
  getTextProgress.mockReset();
  // The token loader is called once per chapter; default to "no
  // tokens written yet" so the loader falls back to client-side
  // tokenization in tests that don't care.
  loadChapterTokens.mockResolvedValue(null);
  // T-14.3: phrase spans default to an empty array — existing
  // tests stay phrase-agnostic.
  loadChapterPhraseSpans.mockResolvedValue([]);
  // No saved progress unless a test stages it.
  getTextProgress.mockResolvedValue(null);
  // No persisted reader settings unless a test stages a row.
  userLanguagesRow = null;
});

afterEach(() => {
  vi.resetModules();
});

describe('/reader/[textId] loader', () => {
  it('returns text + chapters + default anchor + default mode', async () => {
    getReadableText.mockResolvedValueOnce(ownedTextWithChapters(2));
    const data = (await callLoad(`http://x/reader/${VALID_ID}`)) as {
      anchor: { chapterIdx: number; tokenIdx: number };
      mode: string;
      isOwner: boolean;
    };
    expect(data.anchor).toEqual({ chapterIdx: 0, tokenIdx: 0 });
    // Default reader_layout_mode is 'page' (matches the user_languages
    // column default — T-5.1b's loader reads through to that default).
    expect(data.mode).toBe('page');
    expect(data.isOwner).toBe(true);
  });

  it('honors the ?chapter= and ?token= URL params', async () => {
    getReadableText.mockResolvedValueOnce(ownedTextWithChapters(5));
    const data = (await callLoad(
      `http://x/reader/${VALID_ID}?chapter=2&token=10`,
    )) as { anchor: { chapterIdx: number; tokenIdx: number } };
    expect(data.anchor).toEqual({ chapterIdx: 2, tokenIdx: 10 });
  });

  it('clamps a chapter param above the chapter count to the last chapter', async () => {
    getReadableText.mockResolvedValueOnce(ownedTextWithChapters(3));
    const data = (await callLoad(
      `http://x/reader/${VALID_ID}?chapter=999`,
    )) as { anchor: { chapterIdx: number } };
    expect(data.anchor.chapterIdx).toBe(2);
  });

  it("honors the ?mode= URL param when it's a valid mode value", async () => {
    getReadableText.mockResolvedValueOnce(ownedTextWithChapters(1));
    const data = (await callLoad(
      `http://x/reader/${VALID_ID}?mode=page`,
    )) as { mode: string };
    expect(data.mode).toBe('page');
  });

  it('falls back to the default mode for an unrecognized ?mode= value', async () => {
    getReadableText.mockResolvedValueOnce(ownedTextWithChapters(1));
    const data = (await callLoad(
      `http://x/reader/${VALID_ID}?mode=garbage`,
    )) as { mode: string };
    expect(data.mode).toBe('page');
  });

  it('uses the saved reader_layout_mode from user_languages when no ?mode is given (T-5.1b)', async () => {
    getReadableText.mockResolvedValueOnce(ownedTextWithChapters(1));
    userLanguagesRow = {
      readerLayoutMode: 'continuous',
      wordsPerPage: 250,
      fontFamily: null,
      fontSize: 18,
      lineSpacing: 1.6,
      highlightStyle: 'background',
      readingWidth: 'medium',
      scriptPreference: 'native',
      romanizationScheme: 'iso15919',
    };
    const data = (await callLoad(`http://x/reader/${VALID_ID}`)) as {
      mode: string;
      readerSettings: { readerLayoutMode: string; readingWidth: string };
    };
    expect(data.mode).toBe('continuous');
    expect(data.readerSettings.readerLayoutMode).toBe('continuous');
  });

  it('exposes a default readerSettings when the user has no user_languages row (T-5.1b)', async () => {
    getReadableText.mockResolvedValueOnce(ownedTextWithChapters(1));
    const data = (await callLoad(`http://x/reader/${VALID_ID}`)) as {
      readerSettings: { fontSize: number; readingWidth: string };
    };
    expect(data.readerSettings.fontSize).toBe(18);
    expect(data.readerSettings.readingWidth).toBe('medium');
  });

  it('marks canPersistSettings true for signed-in users and false for anon (T-5.1b)', async () => {
    getReadableText.mockResolvedValueOnce(ownedTextWithChapters(1));
    const signedIn = (await callLoad(`http://x/reader/${VALID_ID}`)) as {
      canPersistSettings: boolean;
    };
    expect(signedIn.canPersistSettings).toBe(true);

    const fixture = ownedTextWithChapters(1);
    getReadableText.mockResolvedValueOnce({
      ...fixture,
      text: { ...fixture.text, ownerId: null, visibility: 'official' },
    });
    const anon = (await callLoad(
      `http://x/reader/${VALID_ID}`,
      VALID_ID,
      null,
    )) as { canPersistSettings: boolean };
    expect(anon.canPersistSettings).toBe(false);
  });

  it('rejects an invalid uuid with 400 before calling the service', async () => {
    const res = (await callLoad('http://x/reader/not-a-uuid', 'not-a-uuid')) as {
      status: number;
    };
    expect(res.status).toBe(400);
    expect(getReadableText).not.toHaveBeenCalled();
  });

  it('returns 404 when the text is missing or unreadable', async () => {
    getReadableText.mockResolvedValueOnce(null);
    const res = (await callLoad(`http://x/reader/${VALID_ID}`)) as {
      status: number;
    };
    expect(res.status).toBe(404);
  });

  it('exposes isAdmin=true only for users with role=admin (T-2.8)', async () => {
    getReadableText.mockResolvedValueOnce(ownedTextWithChapters(1));
    const adminData = (await callLoad(`http://x/reader/${VALID_ID}`, VALID_ID, {
      id: USER.id,
      role: 'admin',
    })) as { isAdmin: boolean };
    expect(adminData.isAdmin).toBe(true);

    getReadableText.mockResolvedValueOnce(ownedTextWithChapters(1));
    const userData = (await callLoad(`http://x/reader/${VALID_ID}`)) as {
      isAdmin: boolean;
    };
    expect(userData.isAdmin).toBe(false);

    getReadableText.mockResolvedValueOnce(ownedTextWithChapters(1));
    const curatorData = (await callLoad(`http://x/reader/${VALID_ID}`, VALID_ID, {
      id: USER.id,
      role: 'curator',
    })) as { isAdmin: boolean };
    // Curators get dictionary access, not pipeline reruns.
    expect(curatorData.isAdmin).toBe(false);

    const fixture = ownedTextWithChapters(1);
    getReadableText.mockResolvedValueOnce({
      ...fixture,
      text: { ...fixture.text, ownerId: null, visibility: 'official' },
    });
    const anonData = (await callLoad(
      `http://x/reader/${VALID_ID}`,
      VALID_ID,
      null,
    )) as { isAdmin: boolean };
    expect(anonData.isAdmin).toBe(false);
  });

  it('lets anonymous viewers read official texts and reports isOwner=false', async () => {
    const fixture = ownedTextWithChapters(1);
    getReadableText.mockResolvedValueOnce({
      ...fixture,
      text: { ...fixture.text, ownerId: null, visibility: 'official' },
    });
    const data = (await callLoad(
      `http://x/reader/${VALID_ID}`,
      VALID_ID,
      null,
    )) as { isOwner: boolean };
    expect(data.isOwner).toBe(false);
    expect(getReadableText).toHaveBeenCalledWith(null, VALID_ID);
  });

  it('reads ?roman=1 as showRomanization=true (T-5.3)', async () => {
    getReadableText.mockResolvedValueOnce(ownedTextWithChapters(1));
    const data = (await callLoad(
      `http://x/reader/${VALID_ID}?roman=1`,
    )) as { showRomanization: boolean };
    expect(data.showRomanization).toBe(true);
  });

  it('defaults showRomanization to false when ?roman is absent', async () => {
    getReadableText.mockResolvedValueOnce(ownedTextWithChapters(1));
    const data = (await callLoad(`http://x/reader/${VALID_ID}`)) as {
      showRomanization: boolean;
    };
    expect(data.showRomanization).toBe(false);
  });

  it('resumes from saved progress when the URL has no anchor (T-5.6)', async () => {
    getReadableText.mockResolvedValueOnce(ownedTextWithChapters(5));
    getTextProgress.mockResolvedValueOnce({
      userId: USER.id,
      textId: VALID_ID,
      lastChapterIdx: 3,
      lastTokenIdx: 42,
      pctRead: 60,
      updatedAt: new Date(),
    });
    const data = (await callLoad(`http://x/reader/${VALID_ID}`)) as {
      anchor: { chapterIdx: number; tokenIdx: number };
    };
    expect(data.anchor.chapterIdx).toBe(3);
    expect(data.anchor.tokenIdx).toBe(42);
  });

  it('honors an explicit URL anchor over saved progress', async () => {
    getReadableText.mockResolvedValueOnce(ownedTextWithChapters(5));
    getTextProgress.mockResolvedValueOnce({
      userId: USER.id,
      textId: VALID_ID,
      lastChapterIdx: 3,
      lastTokenIdx: 42,
      pctRead: 60,
      updatedAt: new Date(),
    });
    const data = (await callLoad(
      `http://x/reader/${VALID_ID}?chapter=1`,
    )) as { anchor: { chapterIdx: number } };
    expect(data.anchor.chapterIdx).toBe(1);
  });

  it('attaches server tokens to the active chapter only (T-5.1a)', async () => {
    getReadableText.mockResolvedValueOnce(ownedTextWithChapters(3));
    const tokenRow = (id: string, idx: number) => ({
      id,
      idx,
      surface: 'पाठ',
      isWord: true,
      isAmbiguous: false,
      isOov: false,
      lemmaId: 'lem-1',
      romanization: null,
      glossDefault: null,
      candidates: [],
      numberForms: null,
      status: 'unknown' as const,
    });
    loadChapterTokens.mockResolvedValueOnce([tokenRow('t0', 0)]);
    const data = (await callLoad(`http://x/reader/${VALID_ID}`)) as {
      chapters: Array<{ id: string; body: string | null; tokens: unknown }>;
    };
    expect(data.chapters[0]!.body).toBe('पाठ');
    expect(data.chapters[1]!.body).toBeNull();
    expect(data.chapters[0]!.tokens).toHaveLength(1);
    expect(data.chapters[1]!.tokens).toBeNull();
    expect(data.chapters[2]!.tokens).toBeNull();
    // Single fetch — only the active (chapter 0) chapter is hit;
    // siblings get filled in client-side via the lazy-load endpoint.
    expect(loadChapterTokens).toHaveBeenCalledTimes(1);
    expect(loadChapterTokens).toHaveBeenCalledWith('c0', USER.id);
  });

  it('keeps sibling chapter bodies out of the SSR payload for mobile (T-12.5)', async () => {
    const longBody = 'x'.repeat(30_000);
    const fixture = ownedTextWithChapters(5);
    getReadableText.mockResolvedValueOnce({
      ...fixture,
      chapters: fixture.chapters.map((chapter) => ({
        ...chapter,
        body: longBody,
        tokenCount: 10_000,
      })),
    });

    const data = (await callLoad(`http://x/reader/${VALID_ID}`)) as {
      chapters: Array<{ body: string | null; tokens: unknown }>;
    };

    expect(data.chapters[0]!.body).toHaveLength(30_000);
    expect(data.chapters.slice(1).every((chapter) => chapter.body === null)).toBe(
      true,
    );
    expect(jsonPayloadBytes(data)).toBeLessThan(MOBILE_RESPONSE_BUDGET_BYTES);
  });

  it('lazy-loads only the requested chapter when ?chapter=N is set (T-5.1a)', async () => {
    getReadableText.mockResolvedValueOnce(ownedTextWithChapters(5));
    loadChapterTokens.mockResolvedValueOnce(null);
    const data = (await callLoad(
      `http://x/reader/${VALID_ID}?chapter=3`,
    )) as { chapters: Array<{ tokens: unknown }> };
    // The loader is invoked exactly once, for the requested chapter's
    // chapter id ("c3").
    expect(loadChapterTokens).toHaveBeenCalledTimes(1);
    expect(loadChapterTokens).toHaveBeenCalledWith('c3', USER.id);
    expect(data.chapters.map((c) => c.tokens)).toEqual([null, null, null, null, null]);
  });

  it('attaches phrase spans to the active chapter only (T-14.3)', async () => {
    getReadableText.mockResolvedValueOnce(ownedTextWithChapters(3));
    loadChapterTokens.mockResolvedValueOnce([
      {
        id: 't0',
        idx: 0,
        surface: 'इंतज़ार',
        isWord: true,
        isAmbiguous: false,
        isOov: false,
        lemmaId: null,
        lemmaCandidates: [],
        features: {},
        sentenceIdx: 0,
        romanization: null,
        numberForms: null,
      },
    ]);
    loadChapterPhraseSpans.mockResolvedValueOnce([
      {
        phraseId: 'phr-1',
        startTokenIdx: 0,
        endTokenIdx: 1,
        glossDefault: 'to wait',
        status: 'unknown',
      },
    ]);
    const data = (await callLoad(`http://x/reader/${VALID_ID}`)) as {
      chapters: Array<{ phraseSpans: unknown }>;
    };
    expect(data.chapters[0]!.phraseSpans).toHaveLength(1);
    // Sibling chapters carry null until the lazy fetch fills them.
    expect(data.chapters[1]!.phraseSpans).toBeNull();
    expect(data.chapters[2]!.phraseSpans).toBeNull();
    // Loader is called once with the active chapter id + viewer id.
    expect(loadChapterPhraseSpans).toHaveBeenCalledTimes(1);
    expect(loadChapterPhraseSpans).toHaveBeenCalledWith('c0', USER.id);
  });

  it('skips phraseSpans loading when the chapter has no tokens (T-14.3)', async () => {
    getReadableText.mockResolvedValueOnce(ownedTextWithChapters(1));
    loadChapterTokens.mockResolvedValueOnce(null);
    const data = (await callLoad(`http://x/reader/${VALID_ID}`)) as {
      chapters: Array<{ phraseSpans: unknown }>;
    };
    expect(data.chapters[0]!.phraseSpans).toBeNull();
    expect(loadChapterPhraseSpans).not.toHaveBeenCalled();
  });
});
