// @vitest-environment node
/**
 * Tests for /upload SSR loader + default action (T-4.1).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createPastedText = vi.fn();
const createTxtText = vi.fn();
const createChapterBookFromEpub = vi.fn();
const createChapterBookFromZip = vi.fn();

vi.mock('$lib/server/texts/upload.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/texts/upload.js')>(
    '$lib/server/texts/upload.js',
  );
  return {
    ...actual,
    createPastedText: (...a: unknown[]) => createPastedText(...a),
    createTxtText: (...a: unknown[]) => createTxtText(...a),
    createChapterBookFromEpub: (...a: unknown[]) =>
      createChapterBookFromEpub(...a),
    createChapterBookFromZip: (...a: unknown[]) =>
      createChapterBookFromZip(...a),
  };
});

type Mod = typeof import('./+page.server.js');

// Verified-by-default in tests — the upload actions gate on
// emailVerifiedAt, so an unverified-user test sets this to null
// explicitly.
const USER = {
  id: 'user-1',
  role: 'user' as const,
  emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
};

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
  createChapterBookFromEpub.mockReset();
  createChapterBookFromZip.mockReset();
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

async function callZipAction(
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
  } as unknown as Parameters<Mod['actions']['zip']>[0];
  try {
    return await actions.zip!(event);
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

  it('rejects unverified users with a 403 verification message', async () => {
    const result = (await callAction(
      { language: 'hi', title: 'X', body: 'hello' },
      { ...USER, emailVerifiedAt: null } as unknown as typeof USER,
    )) as {
      status: number;
      data: { ok: boolean; message: string };
    };
    expect(result.status).toBe(403);
    expect(result.data.message).toMatch(/verify your email/i);
    expect(createPastedText).not.toHaveBeenCalled();
  });
});

describe('/upload epub action', () => {
  function fakeFile(size = 100, name = 'novel.epub') {
    const bytes = new Uint8Array(size);
    return new File([bytes], name, { type: 'application/epub+zip' });
  }

  it('redirects to the new collection for a multi-chapter EPUB', async () => {
    createChapterBookFromEpub.mockResolvedValueOnce({
      kind: 'collection',
      collection: { id: 'col-1', ownerId: USER.id },
      texts: [{ id: 'text-a' }, { id: 'text-b' }],
    });
    const res = (await callEpubAction({
      language: 'hi',
      title: 'My EPUB',
      file: fakeFile(),
    })) as { status: number; location: string };
    expect(res.status).toBe(303);
    expect(res.location).toBe('/collections/col-1');
    expect(createChapterBookFromEpub).toHaveBeenCalledWith(
      { id: USER.id },
      expect.objectContaining({ language: 'hi', title: 'My EPUB' }),
    );
  });

  it('redirects to the reader for a single-chapter EPUB (fallback)', async () => {
    createChapterBookFromEpub.mockResolvedValueOnce({
      kind: 'text',
      text: { id: 'text-3', ownerId: USER.id },
      chapter: { id: 'c0' },
      chapters: [{ id: 'c0' }],
    });
    const res = (await callEpubAction({
      language: 'hi',
      title: 'Solo',
      file: fakeFile(),
    })) as { status: number; location: string };
    expect(res.status).toBe(303);
    expect(res.location).toBe('/reader/text-3');
  });

  it('falls back to filename when no title is given', async () => {
    createChapterBookFromEpub.mockResolvedValueOnce({
      kind: 'text',
      text: { id: 'text-3', ownerId: USER.id },
      chapter: { id: 'c0' },
      chapters: [{ id: 'c0' }],
    });
    await callEpubAction({
      language: 'hi',
      file: fakeFile(100, 'A Hindi Novel.epub'),
    });
    expect(createChapterBookFromEpub).toHaveBeenCalledWith(
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
    expect(createChapterBookFromEpub).not.toHaveBeenCalled();
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
    createChapterBookFromEpub.mockRejectedValueOnce(new EpubParseError('bad zip'));
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

  it('surfaces a language-mismatch as a section=epub fail with a clear message', async () => {
    const { EpubLanguageMismatchError } = await import(
      '$lib/server/texts/upload.js'
    );
    createChapterBookFromEpub.mockRejectedValueOnce(
      new EpubLanguageMismatchError('mr', 'hi'),
    );
    const result = (await callEpubAction({
      language: 'hi',
      title: 'X',
      file: fakeFile(),
    })) as {
      status: number;
      data: { ok: boolean; section: string; message: string };
    };
    expect(result.status).toBe(400);
    expect(result.data.section).toBe('epub');
    expect(result.data.message).toMatch(/Marathi/);
  });

  it('redirects unauthenticated EPUB submissions to /login', async () => {
    const res = (await callEpubAction(
      { language: 'hi', title: 'X', file: fakeFile() },
      null,
    )) as { status: number; location: string };
    expect(res.status).toBe(303);
    expect(res.location).toContain('/login');
  });

  it('rejects unverified users with a 403 verification message', async () => {
    const result = (await callEpubAction(
      { language: 'hi', title: 'X', file: fakeFile() },
      { ...USER, emailVerifiedAt: null } as unknown as typeof USER,
    )) as {
      status: number;
      data: { ok: boolean; section: string; message: string };
    };
    expect(result.status).toBe(403);
    expect(result.data.section).toBe('epub');
    expect(result.data.message).toMatch(/verify your email/i);
    expect(createChapterBookFromEpub).not.toHaveBeenCalled();
  });
});

describe('/upload zip action', () => {
  function fakeFile(size = 100, name = 'book.zip') {
    const bytes = new Uint8Array(size);
    return new File([bytes], name, { type: 'application/zip' });
  }

  it('redirects to the new collection for a multi-file ZIP', async () => {
    createChapterBookFromZip.mockResolvedValueOnce({
      kind: 'collection',
      collection: { id: 'col-9', ownerId: USER.id },
      texts: [{ id: 't1' }, { id: 't2' }],
    });
    const res = (await callZipAction({
      language: 'hi',
      title: 'My ZIP',
      file: fakeFile(),
    })) as { status: number; location: string };
    expect(res.status).toBe(303);
    expect(res.location).toBe('/collections/col-9');
    expect(createChapterBookFromZip).toHaveBeenCalledWith(
      { id: USER.id },
      expect.objectContaining({ language: 'hi', title: 'My ZIP' }),
    );
  });

  it('redirects to the reader for a single-file ZIP (fallback)', async () => {
    createChapterBookFromZip.mockResolvedValueOnce({
      kind: 'text',
      text: { id: 'text-zip', ownerId: USER.id },
      chapter: { id: 'c0' },
      chapters: [{ id: 'c0' }],
    });
    const res = (await callZipAction({
      language: 'hi',
      title: 'Solo',
      file: fakeFile(),
    })) as { status: number; location: string };
    expect(res.status).toBe(303);
    expect(res.location).toBe('/reader/text-zip');
  });

  it('falls back to filename when no title is given', async () => {
    createChapterBookFromZip.mockResolvedValueOnce({
      kind: 'text',
      text: { id: 'text-zip', ownerId: USER.id },
      chapter: { id: 'c0' },
      chapters: [{ id: 'c0' }],
    });
    await callZipAction({
      language: 'hi',
      file: fakeFile(100, 'A Hindi Anthology.zip'),
    });
    expect(createChapterBookFromZip).toHaveBeenCalledWith(
      { id: USER.id },
      expect.objectContaining({ title: 'A Hindi Anthology' }),
    );
  });

  it('rejects a missing file with a section=zip fail', async () => {
    const result = (await callZipAction({
      language: 'hi',
      title: 'X',
    })) as {
      status: number;
      data: { ok: boolean; section: string; message: string };
    };
    expect(result.status).toBe(400);
    expect(result.data.section).toBe('zip');
  });

  it('surfaces a ZipParseError as a section=zip fail', async () => {
    const { ZipParseError } = await import('$lib/server/texts/upload.js');
    createChapterBookFromZip.mockRejectedValueOnce(
      new ZipParseError('no top-level .txt'),
    );
    const result = (await callZipAction({
      language: 'hi',
      title: 'X',
      file: fakeFile(),
    })) as {
      status: number;
      data: { ok: boolean; section: string; message: string };
    };
    expect(result.status).toBe(400);
    expect(result.data.section).toBe('zip');
    expect(result.data.message).toMatch(/top-level/);
  });

  it('rejects unverified users with a 403 verification message', async () => {
    const result = (await callZipAction(
      { language: 'hi', title: 'X', file: fakeFile() },
      { ...USER, emailVerifiedAt: null } as unknown as typeof USER,
    )) as {
      status: number;
      data: { ok: boolean; section: string; message: string };
    };
    expect(result.status).toBe(403);
    expect(result.data.section).toBe('zip');
    expect(result.data.message).toMatch(/verify your email/i);
  });
});
