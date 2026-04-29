// @vitest-environment node
/**
 * Unit tests for the NLP job lifecycle helpers (T-4.4).
 *
 * Same staged-mock pattern as the rest of lib/server/texts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Call =
  | { kind: 'select' }
  | { kind: 'update'; set?: unknown }
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

function makeUpdateChain() {
  const entry: Call = { kind: 'update' };
  calls.push(entry);
  const chain: Record<string, unknown> = {};
  chain.set = vi.fn((v: unknown) => {
    entry.set = v;
    return chain;
  });
  chain.where = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) => resolve(undefined);
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
  return chain;
}

const selectFn = vi.fn(() => {
  calls.push({ kind: 'select' });
  return makeSelectChain();
});
const updateFn = vi.fn(() => makeUpdateChain());
const insertFn = vi.fn(() => makeInsertChain());

// T-8.4: canReadText consults collections.js for collection-share
// access. Mock to "no share" so getTextStatus visibility tests
// keep their pre-T-8.4 outcomes.
vi.mock('../collections.js', () => ({
  viewerHasCollectionShareForText: async () => false,
}));

vi.mock('../db/index.js', () => ({
  db: {
    select: () => selectFn(),
    update: () => updateFn(),
    insert: () => insertFn(),
  },
  schema: {
    texts: { id: 'texts.id', ownerId: 'texts.owner_id' },
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

// T-7.2: getTextStatus' canReadText path now imports sharing.js
// via a dynamic import. Mock to "no share" so existing tests keep
// their semantics.
vi.mock('./sharing.js', () => ({
  viewerHasDirectShare: async () => false,
}));
// T-7.4: same treatment for the groups module.
vi.mock('../groups.js', () => ({
  viewerHasGroupShare: async () => false,
}));

const {
  enqueueNlpJob,
  markTextProcessing,
  markTextReady,
  markTextFailed,
  getTextStatus,
  setJobDispatcher,
  resetJobDispatcher,
} = await import('./jobs.js');

beforeEach(() => {
  calls.length = 0;
  staged.length = 0;
  selectFn.mockClear();
  updateFn.mockClear();
  insertFn.mockClear();
  resetJobDispatcher();
});

afterEach(() => {
  vi.clearAllMocks();
  resetJobDispatcher();
});

describe('enqueueNlpJob', () => {
  it('inserts an nlp_jobs row and dispatches via the active dispatcher', async () => {
    stage([
      {
        id: 'job-1',
        textId: 'text-1',
        status: 'pending',
        createdAt: new Date(),
      },
    ]);
    const dispatch = vi.fn().mockResolvedValueOnce(undefined);
    setJobDispatcher({ dispatch });

    const result = await enqueueNlpJob({
      textId: 'text-1',
      chapterIds: ['c0', 'c1'],
    });
    expect(result.job.id).toBe('job-1');

    const inserts = calls.filter(
      (c): c is Extract<Call, { kind: 'insert' }> => c.kind === 'insert',
    );
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.values).toMatchObject({
      textId: 'text-1',
      status: 'pending',
    });
    expect(dispatch).toHaveBeenCalledWith({
      jobId: 'job-1',
      textId: 'text-1',
      chapterIds: ['c0', 'c1'],
    });
  });

  it('uses the no-op dispatcher by default (no exception, no observable side-effect)', async () => {
    stage([
      {
        id: 'job-2',
        textId: 'text-2',
        status: 'pending',
        createdAt: new Date(),
      },
    ]);
    const result = await enqueueNlpJob({
      textId: 'text-2',
      chapterIds: ['c0'],
    });
    expect(result.job.id).toBe('job-2');
  });
});

describe('markTextProcessing / Ready / Failed', () => {
  it('markTextProcessing flips text + job to processing', async () => {
    await markTextProcessing('text-1');
    const updates = calls.filter(
      (c): c is Extract<Call, { kind: 'update' }> => c.kind === 'update',
    );
    expect(updates).toHaveLength(2);
    expect(updates[0]!.set).toMatchObject({ status: 'processing' });
    expect(updates[1]!.set).toMatchObject({ status: 'processing' });
  });

  it('markTextReady flips text to ready and job to completed', async () => {
    await markTextReady('text-1');
    const updates = calls.filter(
      (c): c is Extract<Call, { kind: 'update' }> => c.kind === 'update',
    );
    expect(updates[0]!.set).toMatchObject({ status: 'ready', statusError: null });
    expect(updates[1]!.set).toMatchObject({ status: 'completed' });
  });

  it('markTextFailed truncates very long error messages', async () => {
    const longErr = 'x'.repeat(2000);
    await markTextFailed('text-1', longErr);
    const updates = calls.filter(
      (c): c is Extract<Call, { kind: 'update' }> => c.kind === 'update',
    );
    const textErr = (updates[0]!.set as { statusError: string }).statusError;
    expect(textErr.length).toBeLessThanOrEqual(1001);
    expect(textErr.endsWith('…')).toBe(true);
  });
});

describe('getTextStatus', () => {
  it('returns status + latest job for the owner', async () => {
    stage([
      {
        id: 'text-1',
        ownerId: 'user-1',
        status: 'processing',
        statusError: null,
      },
    ]);
    stage([
      {
        id: 'job-1',
        textId: 'text-1',
        status: 'processing',
        startedAt: new Date(),
      },
    ]);
    const view = await getTextStatus({ id: 'user-1' }, 'text-1');
    expect(view).not.toBeNull();
    expect(view!.status).toBe('processing');
    expect(view!.job?.id).toBe('job-1');
  });

  it('returns null when the text does not exist', async () => {
    stage([]);
    const view = await getTextStatus({ id: 'user-1' }, 'missing');
    expect(view).toBeNull();
  });

  it('returns null when the viewer is not the owner', async () => {
    stage([{ id: 'text-1', ownerId: 'someone-else', status: 'pending' }]);
    const view = await getTextStatus({ id: 'user-1' }, 'text-1');
    expect(view).toBeNull();
  });

  it('returns a null job when no nlp_jobs row exists', async () => {
    stage([{ id: 'text-1', ownerId: 'user-1', status: 'pending', statusError: null }]);
    stage([]);
    const view = await getTextStatus({ id: 'user-1' }, 'text-1');
    expect(view!.job).toBeNull();
  });
});
