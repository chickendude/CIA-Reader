// @vitest-environment node
/**
 * Unit tests for `submitUserTranslation` (T-3.2).
 *
 * Mocks the drizzle `db` surface to a fluent fake whose return values we
 * stage per-call. The service calls the DB in a fixed order per happy /
 * error path; the stubs below mirror that order explicitly so a drift
 * breaks loudly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Call =
  | { kind: 'select' }
  | { kind: 'insert'; payload?: unknown }
  | { kind: 'update'; set?: unknown }
  | { kind: 'delete' };
const calls: Call[] = [];

/**
 * Staged reads — each pushed value is returned by the NEXT `.limit(…)`
 * (for selects) or `.returning(…)` (for inserts). The service calls:
 *   1. select on lemmas (existence check)
 *   2. optional select on translations (parent check)
 *   3. select count from translations (rate limit)
 *   4. insert into translations ... returning
 */
const staged: Array<unknown[] | { err: Error }> = [];

function stageSelect(rows: unknown[]) {
  staged.push(rows);
}
function stageInsert(rows: unknown[]) {
  staged.push(rows);
}

function nextStaged(): unknown[] {
  const v = staged.shift();
  if (!v) throw new Error('Test bug: no staged result available');
  if (v && typeof v === 'object' && 'err' in v) throw (v as { err: Error }).err;
  return v as unknown[];
}

// The chain is awaitable at any point — both `.limit(1)` (used by
// existence checks) and `.where(...)` (used by the rate-limit count)
// resolve to the next staged result. Drizzle's real builder behaves
// the same way; this keeps the fake flexible to either shape.
function makeSelectChain() {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) => resolve(nextStaged());
  return chain as unknown as {
    from: (...a: unknown[]) => typeof chain;
    where: (...a: unknown[]) => typeof chain;
    limit: (...a: unknown[]) => typeof chain;
  };
}

function makeInsertChain() {
  const chain = {
    values: vi.fn((payload: unknown) => {
      calls.push({ kind: 'insert', payload });
      return chain;
    }),
    returning: vi.fn(() => nextStaged()),
  };
  return chain;
}

function makeUpdateChain() {
  const entry: Call = { kind: 'update' };
  calls.push(entry);
  const chain: Record<string, unknown> = {};
  chain.set = vi.fn((v: unknown) => {
    entry.set = v;
    return chain;
  });
  chain.where = vi.fn(() => chain);
  chain.returning = vi.fn(() => nextStaged());
  return chain;
}

function makeDeleteChain() {
  calls.push({ kind: 'delete' });
  const chain: Record<string, unknown> = {};
  chain.where = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) => resolve(undefined);
  return chain;
}

const selectFn = vi.fn(() => {
  calls.push({ kind: 'select' });
  return makeSelectChain();
});
const insertFn = vi.fn(() => makeInsertChain());
const updateFn = vi.fn(() => makeUpdateChain());
const deleteFn = vi.fn(() => makeDeleteChain());

vi.mock('../db/index.js', () => ({
  db: {
    select: () => selectFn(),
    insert: () => insertFn(),
    update: () => updateFn(),
    delete: () => deleteFn(),
  },
  schema: {
    lemmas: { id: 'lemmas.id' },
    translations: {
      id: 'translations.id',
      targetType: 'translations.target_type',
      targetId: 'translations.target_id',
      submittedBy: 'translations.submitted_by',
      createdAt: 'translations.created_at',
    },
  },
}));

const {
  MAX_BODY_LEN,
  MAX_PER_USER_PER_WINDOW,
  deleteUserTranslation,
  submitUserTranslation,
  TranslationRateLimitError,
  TranslationValidationError,
  updateUserTranslation,
} = await import('./translations.js');

beforeEach(() => {
  calls.length = 0;
  staged.length = 0;
  selectFn.mockClear();
  insertFn.mockClear();
  updateFn.mockClear();
  deleteFn.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('submitUserTranslation — happy path', () => {
  it('normalizes whitespace, tags source=user, and returns the inserted row', async () => {
    stageSelect([{ id: 'lemma-1' }]); // lemma existence check
    stageSelect([{ n: 3 }]); // rate-limit count
    const inserted = {
      id: 'tr-1',
      lemmaId: 'lemma-1',
      source: 'user',
      submittedBy: 'user-1',
      parentTranslationId: null,
      body: 'to speak',
      targetLanguage: 'en',
      sourceAttribution: null,
      sourceId: null,
      hidden: false,
      createdAt: new Date('2026-04-24'),
      updatedAt: new Date('2026-04-24'),
    };
    stageInsert([inserted]);

    const result = await submitUserTranslation('user-1', {
      lemmaId: 'lemma-1',
      body: '  to   speak  ',
    });

    expect(result.id).toBe('tr-1');
    const insertCall = calls.find((c) => c.kind === 'insert');
    // T-14.7a: legacy lemma_id column dropped — the insert
    // payload now writes only the polymorphic target.
    expect(insertCall?.payload).toMatchObject({
      targetType: 'lemma',
      targetId: 'lemma-1',
      source: 'user',
      submittedBy: 'user-1',
      body: 'to speak', // whitespace collapsed
      targetLanguage: 'en',
      parentTranslationId: null,
    });
  });

  it('includes parent check when parentTranslationId is provided', async () => {
    stageSelect([{ id: 'lemma-1' }]);
    // T-14.7a: parent existence check now reads via the
    // polymorphic columns; staged parent row mirrors that.
    stageSelect([{ id: 'parent-1', targetType: 'lemma', targetId: 'lemma-1' }]);
    stageSelect([{ n: 0 }]);
    stageInsert([
      {
        id: 'tr-1',
        lemmaId: 'lemma-1',
        source: 'user',
        submittedBy: 'user-1',
        parentTranslationId: 'parent-1',
        body: 'revised',
        targetLanguage: 'en',
        sourceAttribution: null,
        sourceId: null,
        hidden: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const result = await submitUserTranslation('user-1', {
      lemmaId: 'lemma-1',
      body: 'revised',
      parentTranslationId: 'parent-1',
    });

    expect(result.parentTranslationId).toBe('parent-1');
    // 3 selects: lemma, parent, rate-limit count.
    expect(calls.filter((c) => c.kind === 'select')).toHaveLength(3);
  });

  it('lowercases targetLanguage', async () => {
    stageSelect([{ id: 'lemma-1' }]);
    stageSelect([{ n: 0 }]);
    stageInsert([
      {
        id: 'tr-1',
        lemmaId: 'lemma-1',
        source: 'user',
        submittedBy: 'user-1',
        parentTranslationId: null,
        body: 'water',
        targetLanguage: 'en',
        sourceAttribution: null,
        sourceId: null,
        hidden: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    await submitUserTranslation('user-1', {
      lemmaId: 'lemma-1',
      body: 'water',
      targetLanguage: 'EN',
    });

    const insertCall = calls.find((c) => c.kind === 'insert');
    expect(insertCall?.payload).toMatchObject({ targetLanguage: 'en' });
  });
});

describe('submitUserTranslation — validation errors', () => {
  it('rejects an empty body without touching the DB', async () => {
    await expect(
      submitUserTranslation('user-1', { lemmaId: 'lemma-1', body: '   ' }),
    ).rejects.toBeInstanceOf(TranslationValidationError);
    expect(selectFn).not.toHaveBeenCalled();
  });

  it('rejects a body over MAX_BODY_LEN characters', async () => {
    await expect(
      submitUserTranslation('user-1', {
        lemmaId: 'lemma-1',
        body: 'x'.repeat(MAX_BODY_LEN + 1),
      }),
    ).rejects.toBeInstanceOf(TranslationValidationError);
  });

  it('rejects a malformed target language', async () => {
    await expect(
      submitUserTranslation('user-1', {
        lemmaId: 'lemma-1',
        body: 'water',
        targetLanguage: 'english',
      }),
    ).rejects.toBeInstanceOf(TranslationValidationError);
  });

  it('returns a 404-flavoured error when the lemma does not exist', async () => {
    stageSelect([]); // no lemma
    try {
      await submitUserTranslation('user-1', { lemmaId: 'lemma-missing', body: 'x' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TranslationValidationError);
      expect((err as InstanceType<typeof TranslationValidationError>).status).toBe(404);
    }
  });

  it('rejects a parent translation on a different, non-sibling lemma', async () => {
    stageSelect([{ id: 'lemma-1' }]); // lemma exists
    stageSelect([{ targetType: 'lemma', targetId: 'lemma-OTHER' }]); // parent
    // Sibling comparison: different headwords → a cross-word fork, rejected.
    stageSelect([
      { id: 'lemma-1', headword: 'ur', language: 'eu' },
      { id: 'lemma-OTHER', headword: 'sua', language: 'eu' },
    ]);
    await expect(
      submitUserTranslation('user-1', {
        lemmaId: 'lemma-1',
        body: 'x',
        parentTranslationId: 'parent-1',
      }),
    ).rejects.toBeInstanceOf(TranslationValidationError);
  });

  it('attaches a fork to the parent lemma when it is a same-word sibling', async () => {
    // The reader saw this official via the same-headword fallback: the tapped
    // lemma (lemma-1) is empty, the entry lives on sibling lemma-SIB. The fork
    // must save — pinned to the parent's lemma — not be rejected.
    stageSelect([{ id: 'lemma-1' }]); // lemma exists
    stageSelect([{ targetType: 'lemma', targetId: 'lemma-SIB' }]); // parent
    stageSelect([
      { id: 'lemma-1', headword: 'hegoalde', language: 'eu' },
      { id: 'lemma-SIB', headword: 'hegoalde', language: 'eu' },
    ]);
    stageSelect([{ n: 0 }]); // rate-limit count
    stageInsert([
      {
        id: 'tr-1',
        source: 'user',
        submittedBy: 'user-1',
        parentTranslationId: 'parent-1',
        body: 'southern region',
        targetLanguage: 'en',
        sourceAttribution: null,
        sourceId: null,
        hidden: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    await submitUserTranslation('user-1', {
      lemmaId: 'lemma-1',
      body: 'southern region',
      parentTranslationId: 'parent-1',
    });

    // The note is written against the parent entry's lemma, not the tapped one.
    const insertCall = calls.find((c) => c.kind === 'insert');
    expect(insertCall?.payload).toMatchObject({ targetId: 'lemma-SIB' });
  });

  it('rejects a missing parent translation', async () => {
    stageSelect([{ id: 'lemma-1' }]);
    stageSelect([]); // parent missing
    try {
      await submitUserTranslation('user-1', {
        lemmaId: 'lemma-1',
        body: 'x',
        parentTranslationId: 'parent-missing',
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TranslationValidationError);
      expect((err as InstanceType<typeof TranslationValidationError>).status).toBe(404);
    }
  });
});

describe('submitUserTranslation — rate limiting', () => {
  it('throws TranslationRateLimitError when the user hit the window cap', async () => {
    stageSelect([{ id: 'lemma-1' }]);
    stageSelect([{ n: MAX_PER_USER_PER_WINDOW }]);
    await expect(
      submitUserTranslation('user-1', { lemmaId: 'lemma-1', body: 'x' }),
    ).rejects.toBeInstanceOf(TranslationRateLimitError);
    // Rate-limit rejection means NO insert was attempted.
    expect(insertFn).not.toHaveBeenCalled();
  });

  it('includes a retryAfterSeconds hint roughly equal to the window size', async () => {
    stageSelect([{ id: 'lemma-1' }]);
    stageSelect([{ n: MAX_PER_USER_PER_WINDOW + 5 }]);
    try {
      await submitUserTranslation('user-1', { lemmaId: 'lemma-1', body: 'x' });
    } catch (err) {
      expect(err).toBeInstanceOf(TranslationRateLimitError);
      const e = err as InstanceType<typeof TranslationRateLimitError>;
      expect(e.retryAfterSeconds).toBeGreaterThan(0);
      expect(e.limit).toBe(MAX_PER_USER_PER_WINDOW);
    }
  });
});

describe('updateUserTranslation (T-3.5)', () => {
  const ownRow = {
    id: 'tr-1',
    lemmaId: 'lemma-1',
    source: 'user',
    submittedBy: 'user-1',
    parentTranslationId: null,
    body: 'old body',
    targetLanguage: 'en',
    sourceAttribution: null,
    sourceId: null,
    hidden: false,
    createdAt: new Date('2026-04-24'),
    updatedAt: new Date('2026-04-24'),
  };

  it('updates the body for the author', async () => {
    stageSelect([ownRow]);
    stageSelect([{ ...ownRow, body: 'new body' }]); // update ... returning
    const updated = await updateUserTranslation('user-1', 'tr-1', {
      body: '  new   body  ',
    });
    expect(updated.body).toBe('new body');
    const updateCall = calls.find((c) => c.kind === 'update');
    expect(updateCall?.set).toMatchObject({ body: 'new body' });
  });

  it('rejects an empty body without touching the DB', async () => {
    await expect(
      updateUserTranslation('user-1', 'tr-1', { body: '   ' }),
    ).rejects.toBeInstanceOf(TranslationValidationError);
    expect(selectFn).not.toHaveBeenCalled();
    expect(updateFn).not.toHaveBeenCalled();
  });

  it('rejects a body over MAX_BODY_LEN characters', async () => {
    await expect(
      updateUserTranslation('user-1', 'tr-1', { body: 'x'.repeat(MAX_BODY_LEN + 1) }),
    ).rejects.toBeInstanceOf(TranslationValidationError);
  });

  it('returns 404 when the translation does not exist', async () => {
    stageSelect([]);
    try {
      await updateUserTranslation('user-1', 'tr-missing', { body: 'x' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TranslationValidationError);
      expect((err as InstanceType<typeof TranslationValidationError>).status).toBe(404);
    }
    expect(updateFn).not.toHaveBeenCalled();
  });

  it('returns 403 when the caller is not the author', async () => {
    stageSelect([{ ...ownRow, submittedBy: 'someone-else' }]);
    try {
      await updateUserTranslation('user-1', 'tr-1', { body: 'x' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TranslationValidationError);
      expect((err as InstanceType<typeof TranslationValidationError>).status).toBe(403);
    }
    expect(updateFn).not.toHaveBeenCalled();
  });

  it('returns 403 when the target row is an official translation', async () => {
    stageSelect([{ ...ownRow, source: 'official_dictionary', submittedBy: null }]);
    await expect(
      updateUserTranslation('user-1', 'tr-1', { body: 'x' }),
    ).rejects.toBeInstanceOf(TranslationValidationError);
    expect(updateFn).not.toHaveBeenCalled();
  });

  it('sets updatedAt to the provided clock', async () => {
    stageSelect([ownRow]);
    stageSelect([{ ...ownRow, body: 'x' }]);
    const t = new Date('2026-05-01T00:00:00Z');
    await updateUserTranslation('user-1', 'tr-1', { body: 'x' }, t);
    const updateCall = calls.find((c) => c.kind === 'update');
    expect((updateCall?.set as { updatedAt: Date }).updatedAt).toBe(t);
  });
});

describe('deleteUserTranslation (T-3.5)', () => {
  const ownRow = {
    id: 'tr-1',
    lemmaId: 'lemma-1',
    source: 'user',
    submittedBy: 'user-1',
    parentTranslationId: null,
    body: 'gloss',
    targetLanguage: 'en',
    sourceAttribution: null,
    sourceId: null,
    hidden: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('deletes the row for the author', async () => {
    stageSelect([ownRow]);
    await expect(
      deleteUserTranslation('user-1', 'tr-1'),
    ).resolves.toBeUndefined();
    expect(deleteFn).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when the translation does not exist', async () => {
    stageSelect([]);
    try {
      await deleteUserTranslation('user-1', 'tr-missing');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TranslationValidationError);
      expect((err as InstanceType<typeof TranslationValidationError>).status).toBe(404);
    }
    expect(deleteFn).not.toHaveBeenCalled();
  });

  it('returns 403 when the caller is not the author', async () => {
    stageSelect([{ ...ownRow, submittedBy: 'someone-else' }]);
    try {
      await deleteUserTranslation('user-1', 'tr-1');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TranslationValidationError);
      expect((err as InstanceType<typeof TranslationValidationError>).status).toBe(403);
    }
    expect(deleteFn).not.toHaveBeenCalled();
  });

  it('returns 403 when the target row is an official translation', async () => {
    stageSelect([{ ...ownRow, source: 'curator', submittedBy: 'curator-1' }]);
    await expect(
      deleteUserTranslation('user-1', 'tr-1'),
    ).rejects.toBeInstanceOf(TranslationValidationError);
    expect(deleteFn).not.toHaveBeenCalled();
  });
});
