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

vi.mock('../db/index.js', () => ({
  db: {
    select: () => selectFn(),
    insert: () => insertFn(),
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
  },
}));

const {
  TextValidationError,
  createPastedText,
  createTxtText,
  estimateTokenCount,
  getOwnedText,
  MAX_PASTE_BYTES,
  MAX_TXT_BYTES,
  MAX_TITLE_LEN,
} = await import('./upload.js');

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

beforeEach(() => {
  calls.length = 0;
  staged.length = 0;
  selectFn.mockClear();
  insertFn.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

// -----------------------------------------------------------------------
// createPastedText
// -----------------------------------------------------------------------

describe('createPastedText', () => {
  it('inserts a text + first chapter and returns both', async () => {
    stage([textRow()]);
    stage([chapterRow()]);

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
    expect(insertCalls).toHaveLength(2);
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
  });

  it('NFC-normalises body and flattens CRLF', async () => {
    stage([textRow()]);
    const captured = chapterRow({ body: '' });
    stage([captured]);

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
// createTxtText (T-4.2)
// -----------------------------------------------------------------------

describe('createTxtText', () => {
  it('inserts a single chapter for a short body', async () => {
    stage([textRow({ sourceType: 'txt' })]);
    stage([chapterRow({ idx: 0 })]);

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
    stage([textRow({ sourceType: 'txt' })]);
    stage([chapterRow({ idx: 0 })]);
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
// getOwnedText
// -----------------------------------------------------------------------

describe('getOwnedText', () => {
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

  it('returns null when the viewer is not the owner (no chapter SELECT)', async () => {
    stage([textRow({ ownerId: 'someone-else' })]);
    const result = await getOwnedText(OWNER, 'text-1');
    expect(result).toBeNull();
    // Only one SELECT — chapters were never queried.
    expect(calls.filter((c) => c.kind === 'select')).toHaveLength(1);
  });
});
