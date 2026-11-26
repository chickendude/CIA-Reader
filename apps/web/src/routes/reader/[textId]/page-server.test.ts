// @vitest-environment node
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

let userLanguagesRow: Record<string, unknown> | null = null;
let hindiCuratorGrant = false;
const readerCollectionContext = vi.fn();
vi.mock('$lib/server/collections.js', () => ({
  readerCollectionContext: (...a: unknown[]) => readerCollectionContext(...a),
}));

vi.mock('$lib/server/audio/audio.js', () => ({
  listAudioForText: async () => [],
}));

vi.mock('$lib/server/db/index.js', () => {
  const schema = {
    userLanguages: { userId: 'ul.user_id', language: 'ul.language' },
    curatorLanguages: { userId: 'cl.user_id', language: 'cl.language' },
  };
  return {
    db: {
      select: () => ({
        from: (table: object) => ({
          where: () => ({
            limit: () => {
              if (table === schema.curatorLanguages) return hindiCuratorGrant ? [{ language: 'hi' }] : [];
              return userLanguagesRow ? [userLanguagesRow] : [];
            },
          }),
        }),
      }),
    },
    schema,
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
  loadChapterPhraseSpans.mockResolvedValue([]);
  // No saved progress unless a test stages it.
  getTextProgress.mockResolvedValue(null);
  // No persisted reader settings unless a test stages a row.
  userLanguagesRow = null;
  hindiCuratorGrant = false;
  // Default to "text belongs to no collection".
  readerCollectionContext.mockReset();
  readerCollectionContext.mockResolvedValue(null);
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
    expect(data.anchor).toEqual({
      chapterIdx: 0,
      tokenIdx: 0,
      endOfChapter: false,
    });
    expect(data.mode).toBe('page');
    expect(data.isOwner).toBe(true);
  });

  it('opens the displayed chapter number at the requested token', async () => {
    getReadableText.mockResolvedValueOnce(ownedTextWithChapters(5));
    const data = (await callLoad(
      `http://x/reader/${VALID_ID}?chapterNumber=3&token=10`,
    )) as { anchor: { chapterIdx: number; tokenIdx: number; endOfChapter: boolean } };
    expect(data.anchor).toEqual({
      chapterIdx: 2,
      tokenIdx: 10,
      endOfChapter: false,
    });
  });

  it.each([
    ['chapter=10&token=4005&mode=page', 'token=4005&mode=page&chapterNumber=11'],
    ['chapter=0&endOfChapter=1', 'endOfChapter=1&chapterNumber=1'],
    ['chapter=2&chapterNumber=11', 'chapterNumber=11'],
  ])('redirects an old reader link with %s', async (oldQuery, newQuery) => {
    const result = await callLoad(`http://x/reader/${VALID_ID}?${oldQuery}`);
    expect(result).toMatchObject({ status: 307, location: `/reader/${VALID_ID}?${newQuery}` });
  });

  it('honors ?endOfChapter=1 by landing on the last chapter', async () => {
    getReadableText.mockResolvedValueOnce(ownedTextWithChapters(5));
    const data = (await callLoad(
      `http://x/reader/${VALID_ID}?endOfChapter=1`,
    )) as { anchor: { chapterIdx: number; tokenIdx: number; endOfChapter: boolean } };
    expect(data.anchor).toEqual({
      chapterIdx: 4,
      tokenIdx: 0,
      endOfChapter: true,
    });
  });

  it('opens the end of a specific chapter when stepping back within a text', async () => {
    getReadableText.mockResolvedValueOnce(ownedTextWithChapters(5));
    const data = await callLoad(`http://x/reader/${VALID_ID}?chapterNumber=3&endOfChapter=1`);
    expect(data).toMatchObject({ anchor: { chapterIdx: 2, tokenIdx: 0, endOfChapter: true } });
  });

  it('clamps a chapter param above the chapter count to the last chapter', async () => {
    getReadableText.mockResolvedValueOnce(ownedTextWithChapters(3));
    const data = (await callLoad(
      `http://x/reader/${VALID_ID}?chapterNumber=1000`,
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

  it('uses the saved reader_layout_mode from user_languages when no ?mode is given', async () => {
    getReadableText.mockResolvedValueOnce(ownedTextWithChapters(1));
    userLanguagesRow = {
      readerLayoutMode: 'continuous',
      wordsPerPage: 250,
      fontFamily: null,
      fontSize: 18,
      lineSpacing: 1.6,
      highlightStyle: 'none',
      highlightLearning: false,
      readingWidth: 'medium',
      scriptPreference: 'native',
      romanizationScheme: 'iso15919',
    };
    const data = (await callLoad(`http://x/reader/${VALID_ID}`)) as {
      mode: string;
      readerSettings: { readerLayoutMode: string; highlightStyle: string; highlightLearning: boolean };
    };
    expect(data.mode).toBe('continuous');
    expect(data.readerSettings.readerLayoutMode).toBe('continuous');
    expect(data.readerSettings.highlightStyle).toBe('none');
    expect(data.readerSettings.highlightLearning).toBe(false);
  });

  it('exposes a default readerSettings when the user has no user_languages row', async () => {
    getReadableText.mockResolvedValueOnce(ownedTextWithChapters(1));
    const data = (await callLoad(`http://x/reader/${VALID_ID}`)) as {
      readerSettings: { fontSize: number; readingWidth: string };
    };
    expect(data.readerSettings.fontSize).toBe(18);
    expect(data.readerSettings.readingWidth).toBe('medium');
  });

  it('marks canPersistSettings true for signed-in users and false for anon', async () => {
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

  it('exposes isAdmin=true only for users with role=admin', async () => {
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

  it('offers the dictionary editor to staff who can edit the book language', async () => {
    const book = ownedTextWithChapters(1);
    const curator = { id: USER.id, role: 'curator' } as const;
    getReadableText.mockResolvedValue(book);
    const load = (user: TestUser | null) => callLoad('http://x/reader/' + VALID_ID, VALID_ID, user);
    await expect(load(null)).resolves.toMatchObject({ dictionaryEditor: false });
    await expect(load(USER)).resolves.toMatchObject({ dictionaryEditor: false });
    await expect(load(curator)).resolves.toMatchObject({ dictionaryEditor: false });
    hindiCuratorGrant = true;
    await expect(load(curator)).resolves.toMatchObject({ dictionaryEditor: true });
    book.text.language = 'eu';
    await expect(load({ id: USER.id, role: 'admin' })).resolves.toMatchObject({ dictionaryEditor: true });
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

  it('reads ?roman=1 as showRomanization=true', async () => {
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

  it('resumes from saved progress when the URL has no anchor', async () => {
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
      `http://x/reader/${VALID_ID}?chapterNumber=2`,
    )) as { anchor: { chapterIdx: number } };
    expect(data.anchor.chapterIdx).toBe(1);
  });

  it('attaches server tokens to the active chapter only', async () => {
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
    expect(loadChapterTokens).toHaveBeenCalledWith('c0', USER.id, VALID_ID);
  });

  it('keeps sibling chapter bodies out of the SSR payload for mobile', async () => {
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

  it('shares repeated readings on the wire and restores each word at its own position', async () => {
    const { load: unpack } = await import('./+page.js');
    const word = {
      id: 'first', idx: 0, surface: 'पाठ', isWord: true,
      candidates: [{ lemmaId: 'alternative' }], status: 'unknown',
    };
    const tokens = [
      word,
      { ...word, id: 'second', idx: 4 },
      { ...word, id: 'corrected', idx: 9, correctedByViewer: true, candidates: [] },
    ];
    getReadableText.mockResolvedValueOnce(ownedTextWithChapters(2));
    loadChapterTokens.mockResolvedValueOnce(tokens);
    const data = await callLoad(`http://x/reader/${VALID_ID}`) as Parameters<typeof unpack>[0]['data'];
    const packed = data.chapters[0]!.tokens!;
    expect(packed[1]![2]).toBe(packed[0]![2]);
    expect(packed[2]![2]).not.toBe(packed[0]![2]);
    const result = await unpack({ data } as Parameters<typeof unpack>[0]);
    expect(result.chapters[0]!.tokens).toEqual(tokens);
    expect(result.chapters[1]!.tokens).toBeNull();
  });

  it('lazy-loads only the requested chapter when ?chapterNumber=N is set', async () => {
    getReadableText.mockResolvedValueOnce(ownedTextWithChapters(5));
    loadChapterTokens.mockResolvedValueOnce(null);
    const data = (await callLoad(
      `http://x/reader/${VALID_ID}?chapterNumber=4`,
    )) as { chapters: Array<{ tokens: unknown }> };
    // The loader is invoked exactly once, for the requested chapter's
    // chapter id ("c3").
    expect(loadChapterTokens).toHaveBeenCalledTimes(1);
    expect(loadChapterTokens).toHaveBeenCalledWith('c3', USER.id, VALID_ID);
    expect(data.chapters.map((c) => c.tokens)).toEqual([null, null, null, null, null]);
  });

  it('attaches phrase spans to the active chapter only', async () => {
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

  it('surfaces the collection chapter list for the chapter-selector TOC', async () => {
    getReadableText.mockResolvedValueOnce(ownedTextWithChapters(1));
    readerCollectionContext.mockResolvedValueOnce({
      collection: { id: 'col-1', title: 'Big Book', kind: 'chapter_book' },
      position: 1,
      totalCount: 3,
      prevTextId: 'prev-text',
      nextTextId: 'next-text',
      chapters: [
        { textId: 'prev-text', position: 0, title: 'One', tokenCount: 100 },
        { textId: VALID_ID, position: 1, title: 'Two', tokenCount: 200 },
        { textId: 'next-text', position: 2, title: 'Three', tokenCount: 300 },
      ],
    });
    const data = (await callLoad(`http://x/reader/${VALID_ID}`)) as {
      collectionContext: {
        chapters: Array<{ textId: string; title: string; tokenCount: number }>;
      } | null;
    };
    expect(data.collectionContext?.chapters).toHaveLength(3);
    expect(data.collectionContext?.chapters[1]).toEqual({
      textId: VALID_ID,
      position: 1,
      title: 'Two',
      tokenCount: 200,
    });
    // The TOC list must not blow the mobile SSR payload budget.
    expect(jsonPayloadBytes(data)).toBeLessThan(MOBILE_RESPONSE_BUDGET_BYTES);
  });

  it('skips phraseSpans loading when the chapter has no tokens', async () => {
    getReadableText.mockResolvedValueOnce(ownedTextWithChapters(1));
    loadChapterTokens.mockResolvedValueOnce(null);
    const data = (await callLoad(`http://x/reader/${VALID_ID}`)) as {
      chapters: Array<{ phraseSpans: unknown }>;
    };
    expect(data.chapters[0]!.phraseSpans).toBeNull();
    expect(loadChapterPhraseSpans).not.toHaveBeenCalled();
  });
});
