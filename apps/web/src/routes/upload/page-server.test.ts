// @vitest-environment node
/**
 * Tests for /upload SSR loader + default action (T-4.1).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createPastedText = vi.fn();
const createTxtText = vi.fn();
const createEpubText = vi.fn();

vi.mock('$lib/server/texts/upload.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/texts/upload.js')>(
    '$lib/server/texts/upload.js',
  );
  return {
    ...actual,
    createPastedText: (...a: unknown[]) => createPastedText(...a),
    createTxtText: (...a: unknown[]) => createTxtText(...a),
    createEpubText: (...a: unknown[]) => createEpubText(...a),
  };
});

type Mod = typeof import('./+page.server.js');

const USER = { id: 'user-1', role: 'user' as const };

async function callLoad(user: typeof USER | null) {
  const { load } = (await import('./+page.server.js')) as Mod;
  const event = {
    locals: { user },
    url: new URL('http://x/upload'),
  } as unknown as Parameters<Mod['load']>[0];
  try {
    return await load(event);
  } catch (e) {
    return e as { status: number; location?: string };
  }
}

async function callAction(
  fields: Record<string, string>,
  user: typeof USER | null = USER,
) {
  const { actions } = (await import('./+page.server.js')) as Mod;
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const event = {
    locals: { user },
    request: { formData: () => Promise.resolve(fd) } as unknown as Request,
  } as unknown as Parameters<Mod['actions']['paste']>[0];
  try {
    return await actions.paste!(event);
  } catch (e) {
    return e as { status: number; location?: string };
  }
}

beforeEach(() => {
  createPastedText.mockReset();
  createTxtText.mockReset();
  createEpubText.mockReset();
});

async function callEpubAction(
  fields: { language?: string; title?: string; file?: File | null },
  user: typeof USER | null = USER,
) {
  const { actions } = (await import('./+page.server.js')) as Mod;
  const fd = new FormData();
  if (fields.language !== undefined) fd.append('language', fields.language);
  if (fields.title !== undefined) fd.append('title', fields.title);
  if (fields.file) fd.append('file', fields.file);
  const event = {
    locals: { user },
    request: { formData: () => Promise.resolve(fd) } as unknown as Request,
  } as unknown as Parameters<Mod['actions']['epub']>[0];
  try {
    return await actions.epub!(event);
  } catch (e) {
    return e as { status: number; location?: string };
  }
}

afterEach(() => {
  vi.resetModules();
});

describe('/upload loader', () => {
  it('returns the language list and the input limits for an authenticated user', async () => {
    const data = (await callLoad(USER)) as {
      languages: Array<{ code: string }>;
      limits: {
        maxTitleLength: number;
        maxPasteBytes: number;
        maxTxtBytes: number;
      };
    };
    expect(data.languages.length).toBeGreaterThan(0);
    expect(data.languages.map((l) => l.code)).toEqual(
      expect.arrayContaining(['hi', 'mr', 'or']),
    );
    expect(data.limits.maxPasteBytes).toBeGreaterThan(0);
    // .txt path must allow strictly more bytes than paste.
    expect(data.limits.maxTxtBytes).toBeGreaterThan(data.limits.maxPasteBytes);
  });

  it('redirects unauthenticated visitors to /login with a next param', async () => {
    const res = (await callLoad(null)) as { status: number; location: string };
    expect(res.status).toBe(303);
    expect(res.location).toBe('/login?next=%2Fupload');
  });
});

describe('/upload paste action', () => {
  it('calls createPastedText with the form values and 303s to the new text', async () => {
    createPastedText.mockResolvedValueOnce({
      text: { id: 'text-1', ownerId: USER.id },
      chapter: { id: 'chap-1' },
      chapters: [{ id: 'chap-1' }],
    });
    const res = (await callAction({
      language: 'hi',
      title: 'My text',
      body: 'पाठ का मूल पाठ।',
    })) as { status: number; location: string };
    expect(res.status).toBe(303);
    expect(res.location).toBe('/reader/text-1');
    expect(createPastedText).toHaveBeenCalledWith(
      { id: USER.id },
      { language: 'hi', title: 'My text', body: 'पाठ का मूल पाठ।' },
    );
    expect(createTxtText).not.toHaveBeenCalled();
  });

  it('routes sourceType=txt through createTxtText', async () => {
    createTxtText.mockResolvedValueOnce({
      text: { id: 'text-2', ownerId: USER.id },
      chapter: { id: 'c0' },
      chapters: [{ id: 'c0' }, { id: 'c1' }],
    });
    const res = (await callAction({
      sourceType: 'txt',
      language: 'hi',
      title: 'Big book',
      body: 'first.\n---\nsecond.',
    })) as { status: number; location: string };
    expect(res.status).toBe(303);
    expect(res.location).toBe('/reader/text-2');
    expect(createTxtText).toHaveBeenCalledTimes(1);
    expect(createPastedText).not.toHaveBeenCalled();
  });

  it('returns a fail() with echoed values on validation failure', async () => {
    const result = (await callAction({
      language: 'xx',
      title: '',
      body: 'hello',
    })) as {
      status: number;
      data: { ok: boolean; values: { title: string; body: string } };
    };
    expect(result.status).toBe(400);
    expect(result.data.ok).toBe(false);
    expect(result.data.values.body).toBe('hello');
    expect(createPastedText).not.toHaveBeenCalled();
  });

  it('returns a fail() when the service raises a TextValidationError', async () => {
    const { TextValidationError } = await import(
      '$lib/server/texts/upload.js'
    );
    createPastedText.mockRejectedValueOnce(
      new TextValidationError('body cannot be empty'),
    );
    const result = (await callAction({
      language: 'hi',
      title: 'X',
      body: 'hello',
    })) as { status: number; data: { ok: boolean; message: string } };
    expect(result.status).toBe(400);
    expect(result.data.ok).toBe(false);
    expect(result.data.message).toMatch(/empty/);
  });

  it('redirects unauthenticated submissions to /login', async () => {
    const res = (await callAction(
      { language: 'hi', title: 'X', body: 'hello' },
      null,
    )) as { status: number; location: string };
    expect(res.status).toBe(303);
    expect(res.location).toContain('/login');
  });
});

describe('/upload epub action', () => {
  function fakeFile(size = 100, name = 'novel.epub') {
    const bytes = new Uint8Array(size);
    return new File([bytes], name, { type: 'application/epub+zip' });
  }

  it('creates an EPUB-sourced text and 303s to it', async () => {
    createEpubText.mockResolvedValueOnce({
      text: { id: 'text-3', ownerId: USER.id },
      chapter: { id: 'c0' },
      chapters: [{ id: 'c0' }, { id: 'c1' }],
    });
    const res = (await callEpubAction({
      language: 'hi',
      title: 'My EPUB',
      file: fakeFile(),
    })) as { status: number; location: string };
    expect(res.status).toBe(303);
    expect(res.location).toBe('/reader/text-3');
    expect(createEpubText).toHaveBeenCalledWith(
      { id: USER.id },
      expect.objectContaining({ language: 'hi', title: 'My EPUB' }),
    );
  });

  it('falls back to filename when no title is given', async () => {
    createEpubText.mockResolvedValueOnce({
      text: { id: 'text-3', ownerId: USER.id },
      chapter: { id: 'c0' },
      chapters: [{ id: 'c0' }],
    });
    await callEpubAction({
      language: 'hi',
      file: fakeFile(100, 'A Hindi Novel.epub'),
    });
    expect(createEpubText).toHaveBeenCalledWith(
      { id: USER.id },
      expect.objectContaining({ title: 'A Hindi Novel' }),
    );
  });

  it('rejects an unsupported language with a section=epub fail', async () => {
    const result = (await callEpubAction({
      language: 'xx',
      title: 'X',
      file: fakeFile(),
    })) as {
      status: number;
      data: { ok: boolean; section: string; message: string };
    };
    expect(result.status).toBe(400);
    expect(result.data.section).toBe('epub');
    expect(createEpubText).not.toHaveBeenCalled();
  });

  it('rejects a missing file', async () => {
    const result = (await callEpubAction({
      language: 'hi',
      title: 'X',
    })) as {
      status: number;
      data: { ok: boolean; section: string; message: string };
    };
    expect(result.status).toBe(400);
    expect(result.data.section).toBe('epub');
  });

  it('rejects an empty file', async () => {
    const result = (await callEpubAction({
      language: 'hi',
      title: 'X',
      file: fakeFile(0),
    })) as {
      status: number;
      data: { ok: boolean; section: string; message: string };
    };
    expect(result.status).toBe(400);
  });

  it('surfaces an EpubParseError as a section=epub fail', async () => {
    const { EpubParseError } = await import('$lib/server/texts/upload.js');
    createEpubText.mockRejectedValueOnce(new EpubParseError('bad zip'));
    const result = (await callEpubAction({
      language: 'hi',
      title: 'X',
      file: fakeFile(),
    })) as {
      status: number;
      data: { ok: boolean; section: string; message: string };
    };
    expect(result.status).toBe(400);
    expect(result.data.message).toMatch(/bad zip/);
  });

  it('redirects unauthenticated EPUB submissions to /login', async () => {
    const res = (await callEpubAction(
      { language: 'hi', title: 'X', file: fakeFile() },
      null,
    )) as { status: number; location: string };
    expect(res.status).toBe(303);
    expect(res.location).toContain('/login');
  });
});
