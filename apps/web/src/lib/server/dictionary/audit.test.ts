// @vitest-environment node
/**
 * Tests for the lemma-edit audit log helpers (T-3.4).
 *
 * Same fluent-chain fake pattern as `translations.test.ts` — we stage the
 * rows each DB call should return, then assert the inputs the service
 * handed to drizzle.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Call = { kind: 'select' | 'insert'; payload?: unknown };
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
  chain.orderBy = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) => resolve(nextStaged());
  return chain;
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
    lemmaEditHistory: {
      id: 'lemma_edit_history.id',
      lemmaId: 'lemma_edit_history.lemma_id',
      editorId: 'lemma_edit_history.editor_id',
      createdAt: 'lemma_edit_history.created_at',
    },
    lemmaEditChangeType: {
      enumValues: [
        'lemma_update',
        'lemma_unlock',
        'lemma_lock',
        'translation_insert',
        'translation_update',
        'translation_hide',
        'translation_unhide',
        'form_insert',
        'form_delete',
      ],
    },
  },
}));

const { MissingReasonError, listLemmaHistory, recordLemmaEdit } = await import(
  './audit.js'
);

beforeEach(() => {
  calls.length = 0;
  staged.length = 0;
  selectFn.mockClear();
  insertFn.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('recordLemmaEdit', () => {
  it('inserts and returns the audit row on the happy path', async () => {
    const inserted = {
      id: 'edit-1',
      lemmaId: 'lemma-1',
      editorId: 'curator-1',
      changeType: 'lemma_update',
      change: { before: { gloss_default: 'a' }, after: { gloss_default: 'b' } },
      reason: 'fix typo',
      createdAt: new Date('2026-04-24'),
    };
    stage([inserted]);

    const result = await recordLemmaEdit({
      lemmaId: 'lemma-1',
      editorId: 'curator-1',
      changeType: 'lemma_update',
      change: { before: { gloss_default: 'a' }, after: { gloss_default: 'b' } },
      reason: 'fix typo',
    });

    expect(result.id).toBe('edit-1');
    const insertCall = calls.find((c) => c.kind === 'insert');
    expect(insertCall?.payload).toMatchObject({
      lemmaId: 'lemma-1',
      editorId: 'curator-1',
      changeType: 'lemma_update',
      reason: 'fix typo',
    });
  });

  it('trims whitespace off the reason before persisting it', async () => {
    stage([{ id: 'edit-1' }]);
    await recordLemmaEdit({
      lemmaId: 'lemma-1',
      editorId: 'curator-1',
      changeType: 'lemma_unlock',
      change: {},
      reason: '   unlock for re-import   ',
    });
    const insertCall = calls.find((c) => c.kind === 'insert');
    expect(insertCall?.payload).toMatchObject({ reason: 'unlock for re-import' });
  });

  it('throws MissingReasonError for an empty reason', async () => {
    await expect(
      recordLemmaEdit({
        lemmaId: 'lemma-1',
        editorId: 'curator-1',
        changeType: 'lemma_update',
        change: {},
        reason: '',
      }),
    ).rejects.toBeInstanceOf(MissingReasonError);
    expect(insertFn).not.toHaveBeenCalled();
  });

  it('throws MissingReasonError for a whitespace-only reason', async () => {
    await expect(
      recordLemmaEdit({
        lemmaId: 'lemma-1',
        editorId: 'curator-1',
        changeType: 'lemma_update',
        change: {},
        reason: '   \t\n  ',
      }),
    ).rejects.toBeInstanceOf(MissingReasonError);
    expect(insertFn).not.toHaveBeenCalled();
  });

  it('throws MissingReasonError for a reason shorter than the minimum', async () => {
    await expect(
      recordLemmaEdit({
        lemmaId: 'lemma-1',
        editorId: 'curator-1',
        changeType: 'lemma_update',
        change: {},
        reason: 'ok',
      }),
    ).rejects.toBeInstanceOf(MissingReasonError);
  });
});

describe('listLemmaHistory', () => {
  it('returns staged rows for a given lemma', async () => {
    const rows = [
      { id: 'edit-2', lemmaId: 'lemma-1', createdAt: new Date('2026-04-24') },
      { id: 'edit-1', lemmaId: 'lemma-1', createdAt: new Date('2026-04-23') },
    ];
    stage(rows);
    const result = await listLemmaHistory('lemma-1');
    expect(result.map((r) => r.id)).toEqual(['edit-2', 'edit-1']);
  });

  it('passes a default limit to the chain when none is provided', async () => {
    stage([]);
    const chain = makeSelectChainCapture();
    selectFn.mockImplementationOnce(() => {
      calls.push({ kind: 'select' });
      return chain;
    });
    await listLemmaHistory('lemma-1');
    expect(chain.limit).toHaveBeenCalledWith(50);
  });

  it('passes an explicit limit when provided', async () => {
    stage([]);
    const chain = makeSelectChainCapture();
    selectFn.mockImplementationOnce(() => {
      calls.push({ kind: 'select' });
      return chain;
    });
    await listLemmaHistory('lemma-1', 5);
    expect(chain.limit).toHaveBeenCalledWith(5);
  });
});

// Variant that lets us assert on the exact args passed to `.limit(...)`.
function makeSelectChainCapture() {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) => resolve(nextStaged());
  return chain as unknown as {
    from: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
    orderBy: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
  };
}
