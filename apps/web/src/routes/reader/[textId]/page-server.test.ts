// @vitest-environment node
/**
 * Tests for /reader/[textId] SSR loader (T-5.1).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getReadableText = vi.fn();
const loadChapterTokens = vi.fn();

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

type LoadFn = (typeof import('./+page.server.js'))['load'];

const VALID_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER = { id: 'user-1', role: 'user' as const };

async function callLoad(
  url: string,
  textId = VALID_ID,
  user: typeof USER | null = USER,
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
  getTextProgress.mockReset();
  // The token loader is called once per chapter; default to "no
  // tokens written yet" so the loader falls back to client-side
  // tokenization in tests that don't care.
  loadChapterTokens.mockResolvedValue(null);
  // No saved progress unless a test stages it.
  getTextProgress.mockResolvedValue(null);
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
    expect(data.mode).toBe('continuous');
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
    expect(data.mode).toBe('continuous');
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

  it('attaches server tokens onto each chapter when the worker has run', async () => {
    getReadableText.mockResolvedValueOnce(ownedTextWithChapters(2));
    const tokenRow = (id: string, idx: number) => ({
      id,
      idx,
      surface: 'पाठ',
      isWord: true,
      isAmbiguous: false,
      isOov: false,
      lemmaId: 'lem-1',
      romanization: null,
      status: 'unknown' as const,
    });
    loadChapterTokens
      .mockResolvedValueOnce([tokenRow('t0', 0)])
      .mockResolvedValueOnce(null);
    const data = (await callLoad(`http://x/reader/${VALID_ID}`)) as {
      chapters: Array<{ id: string; tokens: unknown }>;
    };
    expect(data.chapters[0]!.tokens).toHaveLength(1);
    expect(data.chapters[1]!.tokens).toBeNull();
    // The loader called the token service once per chapter, with the
    // viewer id forwarded.
    expect(loadChapterTokens).toHaveBeenCalledTimes(2);
    expect(loadChapterTokens).toHaveBeenCalledWith('c0', USER.id);
  });
});
