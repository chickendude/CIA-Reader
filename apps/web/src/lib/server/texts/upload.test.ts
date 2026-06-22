// @vitest-environment node
/**
 * Unit tests for the text upload service (T-4.1).
 *
 * Same staged-mock pattern as `dictionary/curator.test.ts`: each DB call
 * returns a thenable chain that resolves the next staged result. We
 * stage the inserts in order and read back what was passed via the
 * `calls` log.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Call =
  | { kind: 'select' }
  | { kind: 'insert'; values?: unknown };
const calls: Call[] = [];

const staged: Array<unknown[]> = [];
function stage(rows: unknown[]) {
  staged.push(rows);
}
function nextStaged(): unknown[] {
  const v = staged.shift();
  if (!v) throw new Error('Test bug: no staged result available');
  return v;
}

function makeSelectChain() {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) => resolve(nextStaged());
  return chain;
}

function makeInsertChain() {
  const entry: Call = { kind: 'insert' };
  calls.push(entry);
  const chain: Record<string, unknown> = {};
  chain.values = vi.fn((v: unknown) => {
    entry.values = v;
    return chain;
  });
  chain.returning = vi.fn(() => nextStaged());
  chain.then = (resolve: (v: unknown) => unknown) => resolve(undefined);
  return chain;
}

const selectFn = vi.fn(() => {
  calls.push({ kind: 'select' });
  return makeSelectChain();
});
const insertFn = vi.fn(() => makeInsertChain());

// T-8.4: canReadText consults collections.js for collection-share
// access. The chapter-book EPUB/ZIP path also delegates to
// `createChapterBookCollection` here — mocked to a stub that records
// args and returns a synthetic collection so the upload-side tests
// can verify the orchestration without booting the real transactional
// helper (that's tested in collections.test.ts).
const createChapterBookCollectionMock = vi.fn();
vi.mock('../collections.js', () => ({
  viewerHasCollectionShareForText: async () => false,
  createChapterBookCollection: (...a: unknown[]) =>
    createChapterBookCollectionMock(...a),
}));

// db.delete(...).where(...) — the deletion path used by `deleteText`.
// Records the call so tests can assert it fired (or didn't). Resolves
// to `undefined` to mirror the real builder.
type DeleteCall = { table: unknown };
const deleteCalls: DeleteCall[] = [];
function makeDeleteChain() {
  const entry: DeleteCall = { table: null };
  deleteCalls.push(entry);
  const chain: Record<string, unknown> = {};
  chain.where = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) => resolve(undefined);
  return chain;
}
const deleteFn = vi.fn((table: unknown) => {
  const chain = makeDeleteChain();
  deleteCalls[deleteCalls.length - 1]!.table = table;
  return chain;
});

vi.mock('../db/index.js', () => ({
  db: {
    select: () => selectFn(),
    insert: () => insertFn(),
    delete: (table: unknown) => deleteFn(table),
  },
  schema: {
    texts: {
      id: 'texts.id',
      ownerId: 'texts.owner_id',
    },
    textChapters: {
      id: 'text_chapters.id',
      textId: 'text_chapters.text_id',
      idx: 'text_chapters.idx',
    },
    nlpJobs: {
      id: 'nlp_jobs.id',
      textId: 'nlp_jobs.text_id',
      status: 'nlp_jobs.status',
      createdAt: 'nlp_jobs.created_at',
    },
    textShares: {
      textId: 'text_shares.text_id',
      sharedWithUserId: 'text_shares.shared_with_user_id',
    },
  },
}));

// T-7.2: canReadText consults the sharing module via dynamic import.
// Default to "no share" so the existing visibility / owner cases
// keep their pre-T-7.2 outcomes; tests that care can override.
vi.mock('./sharing.js', () => ({
  viewerHasDirectShare: async () => false,
}));
// T-7.4: same treatment for the groups module.
vi.mock('../groups.js', () => ({
  viewerHasGroupShare: async () => false,
}));

const {
  TextValidationError,
  EpubParseError,
  EpubLanguageMismatchError,
  ZipParseError,
  createPastedText,
  createTxtText,
  createChapterBookFromEpub,
  createChapterBookFromZip,
  deleteText,
  estimateTokenCount,
  getOwnedText,
  MAX_PASTE_BYTES,
  MAX_TXT_BYTES,
  MAX_EPUB_BYTES,
  MAX_ZIP_BYTES,
  MAX_TITLE_LEN,
  createPdfText,
  MAX_PDF_PAGES,
} = await import('./upload.js');

const JSZip = (await import('jszip')).default;

async function buildFixtureEpub(
  chapters: Array<{ id: string; href: string; title: string; bodyHtml: string }>,
  /** Optional `<dc:language>` to include in the OPF metadata. */
  language?: string,
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
  );
  const manifest = chapters
    .map((c) => `<item id="${c.id}" href="${c.href}" media-type="application/xhtml+xml"/>`)
    .join('\n');
  const spine = chapters.map((c) => `<itemref idref="${c.id}"/>`).join('\n');
  const metadata = language
    ? `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:language>${language}</dc:language></metadata>`
    : '';
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0"?>
<package version="3.0">
  ${metadata}
  <manifest>${manifest}</manifest>
  <spine>${spine}</spine>
</package>`,
  );
  for (const c of chapters) {
    zip.file(
      `OEBPS/${c.href}`,
      `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${c.title}</title></head>
<body>${c.bodyHtml}</body>
</html>`,
    );
  }
  return zip.generateAsync({ type: 'uint8array' });
}

const OWNER = { id: 'user-1' };

function textRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'text-1',
    ownerId: OWNER.id,
    language: 'hi',
    title: 'My text',
    sourceType: 'paste',
    status: 'pending',
    visibility: 'private',
    statusError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function chapterRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'chap-1',
    textId: 'text-1',
    idx: 0,
    title: null,
    body: 'पाठ का मूल पाठ।',
    tokenCount: 4,
    createdAt: new Date(),
    ...overrides,
  };
}

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    textId: 'text-1',
    status: 'pending',
    error: null,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

/** Convenience: stage all three returning() rows for a happy-path
 * create-text call (text + chapters + nlp_jobs). */
function stageHappyPath(opts: {
  text?: ReturnType<typeof textRow>;
  chapters?: ReturnType<typeof chapterRow>[];
  job?: ReturnType<typeof jobRow>;
} = {}) {
  stage([opts.text ?? textRow()]);
  stage(opts.chapters ?? [chapterRow()]);
  stage([opts.job ?? jobRow()]);
}

beforeEach(() => {
  calls.length = 0;
  staged.length = 0;
  deleteCalls.length = 0;
  selectFn.mockClear();
  insertFn.mockClear();
  deleteFn.mockClear();
  createChapterBookCollectionMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// -----------------------------------------------------------------------
// createPastedText
// -----------------------------------------------------------------------

describe('createPastedText', () => {
  it('inserts a text + first chapter + nlp_jobs row, returns text/chapters', async () => {
    stageHappyPath();

    const result = await createPastedText(OWNER, {
      language: 'hi',
      title: '  My text  ',
      body: 'पाठ का मूल पाठ।',
    });
    expect(result.text.id).toBe('text-1');
    expect(result.chapter.id).toBe('chap-1');

    const insertCalls = calls.filter(
      (c): c is Extract<Call, { kind: 'insert' }> => c.kind === 'insert',
    );
    // T-4.4: text + chapters + nlp_jobs.
    expect(insertCalls).toHaveLength(3);
    expect(insertCalls[0]!.values).toMatchObject({
      ownerId: OWNER.id,
      language: 'hi',
      title: 'My text', // collapsed whitespace
      sourceType: 'paste',
      status: 'pending',
      visibility: 'private',
    });
    // Chapter values are passed as an array (T-4.2 batches them).
    const chapterValues = insertCalls[1]!.values as Array<Record<string, unknown>>;
    expect(chapterValues).toHaveLength(1);
    expect(chapterValues[0]).toMatchObject({
      textId: 'text-1',
      idx: 0,
      title: null,
    });
    // nlp_jobs insert (T-4.4).
    expect(insertCalls[2]!.values).toMatchObject({
      textId: 'text-1',
      status: 'pending',
    });
  });

  it('NFC-normalises body and flattens CRLF', async () => {
    stage([textRow()]);
    const captured = chapterRow({ body: '' });
    stage([captured]);
    stage([jobRow()]);

    // Decomposed form + Windows line endings.
    const body = 'line one\r\nline two\rline three'.normalize('NFD');
    await createPastedText(OWNER, {
      language: 'hi',
      title: 'X',
      body,
    });
    const chapterInsert = calls.filter(
      (c): c is Extract<Call, { kind: 'insert' }> => c.kind === 'insert',
    )[1]!;
    const chapterValues = chapterInsert.values as Array<{ body: string }>;
    // No CR characters survive the normalize.
    expect(chapterValues[0]!.body).toBe('line one\nline two\nline three');
  });

  it('rejects an unsupported language', async () => {
    await expect(
      createPastedText(OWNER, {
        language: 'xx',
        title: 'X',
        body: 'hello',
      }),
    ).rejects.toBeInstanceOf(TextValidationError);
    expect(calls).toHaveLength(0);
  });

  it('rejects an empty title', async () => {
    await expect(
      createPastedText(OWNER, {
        language: 'hi',
        title: '   ',
        body: 'hello',
      }),
    ).rejects.toBeInstanceOf(TextValidationError);
  });

  it('rejects a title over MAX_TITLE_LEN', async () => {
    await expect(
      createPastedText(OWNER, {
        language: 'hi',
        title: 'x'.repeat(MAX_TITLE_LEN + 1),
        body: 'hello',
      }),
    ).rejects.toBeInstanceOf(TextValidationError);
  });

  it('rejects an empty body', async () => {
    await expect(
      createPastedText(OWNER, {
        language: 'hi',
        title: 'X',
        body: '   \n\n  ',
      }),
    ).rejects.toBeInstanceOf(TextValidationError);
  });

  it('rejects a body over the byte cap', async () => {
    // ~1.05 MB string of single-byte chars
    const oversized = 'a'.repeat(MAX_PASTE_BYTES + 1);
    await expect(
      createPastedText(OWNER, {
        language: 'hi',
        title: 'X',
        body: oversized,
      }),
    ).rejects.toBeInstanceOf(TextValidationError);
  });
});

// -----------------------------------------------------------------------
// createPdfText (PDF image reader)
// -----------------------------------------------------------------------

describe('createPdfText', () => {
  it('inserts a pdf text + N empty page chapters + nlp_jobs, no enqueue', async () => {
    stage([textRow({ sourceType: 'pdf' })]);
    stage([
      chapterRow({ id: 'chap-0', idx: 0, body: '', tokenCount: 0 }),
      chapterRow({ id: 'chap-1', idx: 1, body: '', tokenCount: 0 }),
    ]);

    const result = await createPdfText(OWNER, {
      language: 'eu',
      title: '  Scanned book  ',
      pageCount: 2,
    });
    expect(result.text.id).toBe('text-1');
    expect(result.chapters).toHaveLength(2);

    const insertCalls = calls.filter(
      (c): c is Extract<Call, { kind: 'insert' }> => c.kind === 'insert',
    );
    // texts + chapters + nlp_jobs (NOT enqueued via the dispatcher).
    expect(insertCalls).toHaveLength(3);
    expect(insertCalls[0]!.values).toMatchObject({
      ownerId: OWNER.id,
      language: 'eu',
      title: 'Scanned book',
      sourceType: 'pdf',
      status: 'pending',
      visibility: 'private',
    });
    const chapterValues = insertCalls[1]!.values as Array<Record<string, unknown>>;
    expect(chapterValues).toHaveLength(2);
    expect(chapterValues[0]).toMatchObject({ textId: 'text-1', idx: 0, body: '', tokenCount: 0 });
    expect(chapterValues[1]).toMatchObject({ idx: 1, body: '' });
    expect(insertCalls[2]!.values).toMatchObject({ textId: 'text-1', status: 'pending' });
  });

  it('rejects a non-positive page count', async () => {
    await expect(
      createPdfText(OWNER, { language: 'eu', title: 'X', pageCount: 0 }),
    ).rejects.toBeInstanceOf(TextValidationError);
    expect(calls).toHaveLength(0);
  });

  it('rejects a page count over the cap', async () => {
    await expect(
      createPdfText(OWNER, { language: 'eu', title: 'X', pageCount: MAX_PDF_PAGES + 1 }),
    ).rejects.toBeInstanceOf(TextValidationError);
  });

  it('rejects an unsupported language', async () => {
    await expect(
      createPdfText(OWNER, { language: 'xx', title: 'X', pageCount: 1 }),
    ).rejects.toBeInstanceOf(TextValidationError);
    expect(calls).toHaveLength(0);
  });

  it('rejects an empty title', async () => {
    await expect(
      createPdfText(OWNER, { language: 'eu', title: '   ', pageCount: 1 }),
    ).rejects.toBeInstanceOf(TextValidationError);
  });
});

// -----------------------------------------------------------------------
// createTxtText (T-4.2)
// -----------------------------------------------------------------------

describe('createTxtText', () => {
  it('inserts a single chapter for a short body', async () => {
    stageHappyPath({
      text: textRow({ sourceType: 'txt' }),
      chapters: [chapterRow({ idx: 0 })],
    });

    const result = await createTxtText(OWNER, {
      language: 'hi',
      title: 'My file',
      body: 'short body, no chunking.',
    });
    expect(result.chapters).toHaveLength(1);

    const insertCalls = calls.filter(
      (c): c is Extract<Call, { kind: 'insert' }> => c.kind === 'insert',
    );
    expect(insertCalls[0]!.values).toMatchObject({ sourceType: 'txt' });
    const chapterValues = insertCalls[1]!.values as Array<Record<string, unknown>>;
    expect(chapterValues).toHaveLength(1);
  });

  it('honors explicit `---` delimiters and inserts one chapter per section', async () => {
    stage([textRow({ sourceType: 'txt' })]);
    // Three chapter rows returned to match the three sections in the body.
    stage([
      chapterRow({ id: 'c0', idx: 0 }),
      chapterRow({ id: 'c1', idx: 1 }),
      chapterRow({ id: 'c2', idx: 2 }),
    ]);
    stage([jobRow()]);

    const body = ['# One', 'first chapter.', '---', '# Two', 'second.', '---', 'third.'].join(
      '\n',
    );
    const result = await createTxtText(OWNER, {
      language: 'hi',
      title: 'Multi-chapter file',
      body,
    });
    expect(result.chapters).toHaveLength(3);

    const chapterInsert = calls.filter(
      (c): c is Extract<Call, { kind: 'insert' }> => c.kind === 'insert',
    )[1]!;
    const values = chapterInsert.values as Array<{
      idx: number;
      title: string | null;
      body: string;
    }>;
    expect(values).toHaveLength(3);
    expect(values.map((v) => v.idx)).toEqual([0, 1, 2]);
    expect(values[0]!.title).toBe('One');
    expect(values[1]!.title).toBe('Two');
    expect(values[2]!.title).toBeNull();
  });

  it('rejects a body over the .txt byte cap', async () => {
    const oversized = 'a'.repeat(MAX_TXT_BYTES + 1);
    await expect(
      createTxtText(OWNER, {
        language: 'hi',
        title: 'too big',
        body: oversized,
      }),
    ).rejects.toBeInstanceOf(TextValidationError);
  });

  it('accepts a body the paste path would reject (between paste-cap and txt-cap)', async () => {
    stageHappyPath({
      text: textRow({ sourceType: 'txt' }),
      chapters: [chapterRow({ idx: 0 })],
    });
    // Build a body just over the paste cap but well under the .txt cap.
    const oversized = 'a'.repeat(MAX_PASTE_BYTES + 100);
    await createTxtText(OWNER, {
      language: 'hi',
      title: 'big file',
      body: oversized,
    });
    // Did not throw.
  });
});

// -----------------------------------------------------------------------
// createChapterBookFromEpub
// -----------------------------------------------------------------------

describe('createChapterBookFromEpub', () => {
  it('creates a chapter-book collection for a multi-chapter EPUB', async () => {
    createChapterBookCollectionMock.mockResolvedValueOnce({
      collection: {
        id: 'col-1',
        ownerId: OWNER.id,
        language: 'hi',
        title: 'Imported novel',
        kind: 'chapter_book',
        visibility: 'private',
      },
      texts: [
        { id: 'text-1' },
        { id: 'text-2' },
      ],
      items: [
        { collectionId: 'col-1', textId: 'text-1', position: 0 },
        { collectionId: 'col-1', textId: 'text-2', position: 1 },
      ],
    });

    const epubBytes = await buildFixtureEpub([
      {
        id: 'ch1',
        href: 'ch1.xhtml',
        title: 'Chapter One',
        bodyHtml: '<p>one body.</p>',
      },
      {
        id: 'ch2',
        href: 'ch2.xhtml',
        title: 'Chapter Two',
        bodyHtml: '<p>two body.</p>',
      },
    ]);

    const result = await createChapterBookFromEpub(OWNER, {
      language: 'hi',
      title: 'Imported novel',
      epubBytes,
    });

    expect(result.kind).toBe('collection');
    if (result.kind !== 'collection') throw new Error('unreachable');
    expect(result.collection.id).toBe('col-1');
    expect(result.texts).toHaveLength(2);

    expect(createChapterBookCollectionMock).toHaveBeenCalledOnce();
    const args = createChapterBookCollectionMock.mock.calls[0]![0];
    expect(args).toMatchObject({
      ownerId: OWNER.id,
      language: 'hi',
      title: 'Imported novel',
      sourceType: 'epub',
    });
    expect(args.chapters).toHaveLength(2);
    expect(args.chapters.map((c: { title: string }) => c.title)).toEqual([
      'Chapter One',
      'Chapter Two',
    ]);
  });

  it('falls back to a single plain text when only one chapter is present', async () => {
    stageHappyPath({ text: textRow({ sourceType: 'epub' }) });

    const epubBytes = await buildFixtureEpub([
      {
        id: 'ch1',
        href: 'ch1.xhtml',
        title: 'Only chapter',
        bodyHtml: '<p>solo body.</p>',
      },
    ]);

    const result = await createChapterBookFromEpub(OWNER, {
      language: 'hi',
      title: 'Imported novel',
      epubBytes,
    });

    expect(result.kind).toBe('text');
    if (result.kind !== 'text') throw new Error('unreachable');
    expect(result.text.sourceType).toBe('epub');
    expect(createChapterBookCollectionMock).not.toHaveBeenCalled();

    // Single-chapter fallback should ALSO prepend the title to the
    // body so NLP tokenizes it — same contract as the multi-chapter
    // chapter_book path. The text_chapters insert is the second
    // .values() call (after the texts row).
    const chapterInsert = calls
      .filter((c): c is Extract<Call, { kind: 'insert' }> => c.kind === 'insert')
      .map((c) => c.values as Array<Record<string, unknown>>)
      .find((v) => Array.isArray(v) && typeof v[0]?.body === 'string');
    expect(chapterInsert).toBeDefined();
    expect((chapterInsert![0]!.body as string).startsWith('Only chapter')).toBe(true);
  });

  it('rejects when EPUB dc:language disagrees with selected language (both supported)', async () => {
    const epubBytes = await buildFixtureEpub(
      [
        {
          id: 'ch1',
          href: 'ch1.xhtml',
          title: 'A',
          bodyHtml: '<p>body.</p>',
        },
        {
          id: 'ch2',
          href: 'ch2.xhtml',
          title: 'B',
          bodyHtml: '<p>body.</p>',
        },
      ],
      'mr',
    );
    await expect(
      createChapterBookFromEpub(OWNER, {
        language: 'hi',
        title: 'X',
        epubBytes,
      }),
    ).rejects.toBeInstanceOf(EpubLanguageMismatchError);
    expect(createChapterBookCollectionMock).not.toHaveBeenCalled();
  });

  it('trusts the user selection when the declared language is unsupported (e.g. a Basque book tagged es)', async () => {
    // EPUB <dc:language> is unreliable for minority languages — Basque
    // books published in Spain are routinely tagged `es`, Yiddish books
    // `he`. An unsupported declared tag tells us nothing, so the user's
    // explicit dropdown selection wins rather than blocking the upload.
    createChapterBookCollectionMock.mockResolvedValueOnce({
      collection: { id: 'col-1' },
      texts: [{ id: 'text-1' }, { id: 'text-2' }],
      items: [],
    });
    const epubBytes = await buildFixtureEpub(
      [
        { id: 'ch1', href: 'ch1.xhtml', title: 'A', bodyHtml: '<p>body.</p>' },
        { id: 'ch2', href: 'ch2.xhtml', title: 'B', bodyHtml: '<p>body.</p>' },
      ],
      'es',
    );
    const result = await createChapterBookFromEpub(OWNER, {
      language: 'eu',
      title: 'X',
      epubBytes,
    });
    expect(result.kind).toBe('collection');
    expect(createChapterBookCollectionMock).toHaveBeenCalledOnce();
  });

  it('trusts the user selection when the EPUB has no <dc:language>', async () => {
    createChapterBookCollectionMock.mockResolvedValueOnce({
      collection: { id: 'col-1' },
      texts: [{ id: 'text-1' }, { id: 'text-2' }],
      items: [],
    });
    const epubBytes = await buildFixtureEpub([
      { id: 'ch1', href: 'ch1.xhtml', title: 'A', bodyHtml: '<p>body.</p>' },
      { id: 'ch2', href: 'ch2.xhtml', title: 'B', bodyHtml: '<p>body.</p>' },
    ]);
    const result = await createChapterBookFromEpub(OWNER, {
      language: 'or',
      title: 'X',
      epubBytes,
    });
    expect(result.kind).toBe('collection');
    expect(createChapterBookCollectionMock).toHaveBeenCalledOnce();
  });

  it('accepts a matching dc:language and strips region subtags', async () => {
    createChapterBookCollectionMock.mockResolvedValueOnce({
      collection: { id: 'col-1' },
      texts: [{ id: 'text-1' }, { id: 'text-2' }],
      items: [],
    });
    const epubBytes = await buildFixtureEpub(
      [
        { id: 'ch1', href: 'ch1.xhtml', title: 'A', bodyHtml: '<p>body.</p>' },
        { id: 'ch2', href: 'ch2.xhtml', title: 'B', bodyHtml: '<p>body.</p>' },
      ],
      'hi-IN',
    );
    const result = await createChapterBookFromEpub(OWNER, {
      language: 'hi',
      title: 'X',
      epubBytes,
    });
    expect(result.kind).toBe('collection');
  });

  it('rejects an unsupported user-selected language without parsing', async () => {
    const epubBytes = await buildFixtureEpub([
      { id: 'ch1', href: 'ch1.xhtml', title: 'X', bodyHtml: '<p>body.</p>' },
    ]);
    await expect(
      createChapterBookFromEpub(OWNER, { language: 'xx', title: 'X', epubBytes }),
    ).rejects.toBeInstanceOf(TextValidationError);
  });

  it('rejects a missing title', async () => {
    const epubBytes = await buildFixtureEpub([
      { id: 'ch1', href: 'ch1.xhtml', title: 'X', bodyHtml: '<p>body.</p>' },
    ]);
    await expect(
      createChapterBookFromEpub(OWNER, { language: 'hi', title: '', epubBytes }),
    ).rejects.toBeInstanceOf(TextValidationError);
  });

  it('rejects an empty file', async () => {
    await expect(
      createChapterBookFromEpub(OWNER, {
        language: 'hi',
        title: 'X',
        epubBytes: new Uint8Array(0),
      }),
    ).rejects.toBeInstanceOf(TextValidationError);
  });

  it('rejects an oversize archive', async () => {
    const tooBig = new ArrayBuffer(MAX_EPUB_BYTES + 1);
    await expect(
      createChapterBookFromEpub(OWNER, {
        language: 'hi',
        title: 'X',
        epubBytes: tooBig,
      }),
    ).rejects.toBeInstanceOf(TextValidationError);
  });

  it('surfaces parse failures as EpubParseError', async () => {
    await expect(
      createChapterBookFromEpub(OWNER, {
        language: 'hi',
        title: 'X',
        epubBytes: new Uint8Array([1, 2, 3, 4]),
      }),
    ).rejects.toBeInstanceOf(EpubParseError);
  });
});

// -----------------------------------------------------------------------
// createChapterBookFromZip
// -----------------------------------------------------------------------

async function buildFixtureZip(
  entries: Record<string, string | Uint8Array>,
): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, body] of Object.entries(entries)) {
    zip.file(name, body);
  }
  return zip.generateAsync({ type: 'uint8array' });
}

describe('createChapterBookFromZip', () => {
  it('creates a chapter-book collection for a multi-file ZIP', async () => {
    createChapterBookCollectionMock.mockResolvedValueOnce({
      collection: { id: 'col-1' },
      texts: [{ id: 'text-1' }, { id: 'text-2' }],
      items: [],
    });
    const zipBytes = await buildFixtureZip({
      '01-intro.txt': 'Intro body.',
      '02-end.txt': 'Ending body.',
    });
    const result = await createChapterBookFromZip(OWNER, {
      language: 'hi',
      title: 'My ZIP book',
      zipBytes,
    });
    expect(result.kind).toBe('collection');
    expect(createChapterBookCollectionMock).toHaveBeenCalledOnce();
    const args = createChapterBookCollectionMock.mock.calls[0]![0];
    expect(args).toMatchObject({
      ownerId: OWNER.id,
      language: 'hi',
      title: 'My ZIP book',
      sourceType: 'zip',
    });
    expect(args.chapters.map((c: { title: string }) => c.title)).toEqual([
      '01-intro',
      '02-end',
    ]);
  });

  it('falls back to a single plain text for a 1-file ZIP', async () => {
    stageHappyPath({ text: textRow({ sourceType: 'zip' }) });
    const zipBytes = await buildFixtureZip({ 'only.txt': 'Solo body.' });
    const result = await createChapterBookFromZip(OWNER, {
      language: 'hi',
      title: 'X',
      zipBytes,
    });
    expect(result.kind).toBe('text');
    if (result.kind !== 'text') throw new Error('unreachable');
    expect(result.text.sourceType).toBe('zip');
    expect(createChapterBookCollectionMock).not.toHaveBeenCalled();

    // Single-file ZIP fallback also prepends the chapter title
    // (filename minus extension) so its words land in NLP.
    const chapterInsert = calls
      .filter((c): c is Extract<Call, { kind: 'insert' }> => c.kind === 'insert')
      .map((c) => c.values as Array<Record<string, unknown>>)
      .find((v) => Array.isArray(v) && typeof v[0]?.body === 'string');
    expect(chapterInsert).toBeDefined();
    expect((chapterInsert![0]!.body as string).startsWith('only')).toBe(true);
  });

  it('rejects an unsupported language without parsing', async () => {
    const zipBytes = await buildFixtureZip({ 'a.txt': 'Body.' });
    await expect(
      createChapterBookFromZip(OWNER, { language: 'xx', title: 'X', zipBytes }),
    ).rejects.toBeInstanceOf(TextValidationError);
  });

  it('rejects an empty ZIP', async () => {
    await expect(
      createChapterBookFromZip(OWNER, {
        language: 'hi',
        title: 'X',
        zipBytes: new Uint8Array(0),
      }),
    ).rejects.toBeInstanceOf(TextValidationError);
  });

  it('rejects an oversize ZIP', async () => {
    const tooBig = new ArrayBuffer(MAX_ZIP_BYTES + 1);
    await expect(
      createChapterBookFromZip(OWNER, {
        language: 'hi',
        title: 'X',
        zipBytes: tooBig,
      }),
    ).rejects.toBeInstanceOf(TextValidationError);
  });

  it('surfaces parse failures (no top-level .txt files) as ZipParseError', async () => {
    const zipBytes = await buildFixtureZip({ 'nested/inner.txt': 'Body.' });
    await expect(
      createChapterBookFromZip(OWNER, {
        language: 'hi',
        title: 'X',
        zipBytes,
      }),
    ).rejects.toBeInstanceOf(ZipParseError);
  });
});

// -----------------------------------------------------------------------
// deleteText
// -----------------------------------------------------------------------

describe('deleteText', () => {
  it('deletes when the actor owns the text', async () => {
    stage([{ id: 'text-1', ownerId: OWNER.id }]); // pre-check select
    await deleteText('text-1', { id: OWNER.id, role: 'user' });
    expect(deleteCalls).toHaveLength(1);
  });

  it('deletes when the actor is an admin even if they do not own it', async () => {
    stage([{ id: 'text-1', ownerId: 'someone-else' }]);
    await deleteText(
      'text-1',
      { id: 'admin-id', role: 'admin' },
    );
    expect(deleteCalls).toHaveLength(1);
  });

  it('throws 404 when the text does not exist', async () => {
    stage([]); // pre-check select returns no row
    await expect(
      deleteText('missing', { id: OWNER.id, role: 'user' }),
    ).rejects.toMatchObject({
      name: 'TextValidationError',
      status: 404,
    });
    expect(deleteCalls).toHaveLength(0);
  });

  it('throws 404 (not 403) for a non-owner non-admin — no existence leak', async () => {
    stage([{ id: 'text-1', ownerId: 'someone-else' }]);
    await expect(
      deleteText('text-1', { id: OWNER.id, role: 'user' }),
    ).rejects.toMatchObject({
      name: 'TextValidationError',
      status: 404,
    });
    expect(deleteCalls).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------
// estimateTokenCount
// -----------------------------------------------------------------------

describe('estimateTokenCount', () => {
  it('counts whitespace-separated tokens', () => {
    expect(estimateTokenCount('hello world')).toBe(2);
    expect(estimateTokenCount('  hello   world  ')).toBe(2);
    expect(estimateTokenCount('one\ntwo\tthree')).toBe(3);
  });
  it('returns 0 on an empty / whitespace-only body', () => {
    expect(estimateTokenCount('')).toBe(0);
    expect(estimateTokenCount('   \n  ')).toBe(0);
  });
});

// -----------------------------------------------------------------------
// getReadableText (T-4.6)
// -----------------------------------------------------------------------

describe('getReadableText', () => {
  it('returns the text + ordered chapters when the viewer owns it', async () => {
    stage([textRow()]);
    stage([
      chapterRow({ id: 'c0', idx: 0 }),
      chapterRow({ id: 'c1', idx: 1, body: 'दूसरा अध्याय' }),
    ]);
    const result = await getOwnedText(OWNER, 'text-1');
    expect(result).not.toBeNull();
    expect(result!.text.id).toBe('text-1');
    expect(result!.chapters).toHaveLength(2);
    expect(result!.chapters.map((c) => c.id)).toEqual(['c0', 'c1']);
  });

  it('returns null when the text does not exist', async () => {
    stage([]); // SELECT empty
    const result = await getOwnedText(OWNER, 'missing');
    expect(result).toBeNull();
  });

  it('returns null when the viewer is not the owner of a private text (no chapter SELECT)', async () => {
    stage([textRow({ ownerId: 'someone-else' })]);
    const result = await getOwnedText(OWNER, 'text-1');
    expect(result).toBeNull();
    // Only one SELECT — chapters were never queried.
    expect(calls.filter((c) => c.kind === 'select')).toHaveLength(1);
  });

  it('lets a non-owner read an official text', async () => {
    stage([textRow({ ownerId: null, visibility: 'official' })]);
    stage([chapterRow({ id: 'c0', idx: 0 })]);
    const result = await getOwnedText(OWNER, 'text-1');
    expect(result).not.toBeNull();
    expect(result!.text.visibility).toBe('official');
  });

  it('lets an anonymous viewer read an official text', async () => {
    stage([textRow({ ownerId: null, visibility: 'official' })]);
    stage([chapterRow({ id: 'c0', idx: 0 })]);
    const result = await getOwnedText(null, 'text-1');
    expect(result).not.toBeNull();
  });

  it('rejects an anonymous viewer of a private text', async () => {
    stage([textRow()]);
    const result = await getOwnedText(null, 'text-1');
    expect(result).toBeNull();
  });
});
