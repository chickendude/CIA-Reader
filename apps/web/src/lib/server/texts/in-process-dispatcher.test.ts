// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Call =
  | { kind: 'select' }
  | { kind: 'update'; set?: unknown }
  | { kind: 'insert'; values?: unknown }
  | { kind: 'delete' };
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
  chain.then = (resolve: (v: unknown) => unknown) => resolve(undefined);
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
const updateFn = vi.fn(() => makeUpdateChain());
const insertFn = vi.fn(() => makeInsertChain());
const deleteFn = vi.fn(() => makeDeleteChain());

vi.mock('../db/index.js', () => ({
  db: {
    select: () => selectFn(),
    update: () => updateFn(),
    insert: () => insertFn(),
    delete: () => deleteFn(),
  },
  schema: {
    texts: { id: 'texts.id' },
    textChapters: { id: 'text_chapters.id', textId: 'text_chapters.text_id', idx: 'text_chapters.idx' },
    textTokens: {
      id: 'text_tokens.id',
      chapterId: 'text_tokens.chapter_id',
    },
    nlpJobs: { id: 'nlp_jobs.id', textId: 'nlp_jobs.text_id', status: 'nlp_jobs.status' },
    lemmas: { id: 'lemmas.id', headword: 'lemmas.headword', pos: 'lemmas.pos', language: 'lemmas.language' },
  },
}));

const nlpProcess = vi.fn();
vi.mock('../nlp-client.js', () => ({
  nlpClient: { process: (...a: unknown[]) => nlpProcess(...a) },
}));

const { processTextNow } = await import('./in-process-dispatcher.js');

beforeEach(() => {
  calls.length = 0;
  staged.length = 0;
  selectFn.mockClear();
  updateFn.mockClear();
  insertFn.mockClear();
  deleteFn.mockClear();
  nlpProcess.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('processTextNow', () => {
  it('runs each chapter through NLP, persists tokens, and marks ready', async () => {
    // text lookup
    stage([{ id: 'text-1', language: 'hi' }]);
    // chapters
    stage([
      { id: 'chap-1', body: 'one' },
      { id: 'chap-2', body: 'two' },
    ]);
    // markTextProcessing — the helper does its own SELECT-less updates
    // so no extra stages needed for the mark-* calls; they only run
    // updates which our mock returns void from.

    // lemma map preload
    stage([
      { id: 'lemma-bolnaa', headword: 'बोलना', pos: 'verb' },
    ]);

    nlpProcess.mockResolvedValueOnce({
      language: 'hi',
      pipeline_id: 'hi/stub',
      tokens: [
        {
          idx: 0,
          surface: 'बोलना',
          is_word: true,
          is_ambiguous: false,
          is_oov: false,
          romanization: 'bolnā',
          candidates: [
            { lemma: 'बोलना', pos: 'verb', score: 0.9, features: { Tense: 'Pres' } },
          ],
        },
      ],
    });
    nlpProcess.mockResolvedValueOnce({
      language: 'hi',
      pipeline_id: 'hi/stub',
      tokens: [
        {
          idx: 0,
          surface: 'unknown',
          is_word: true,
          is_ambiguous: false,
          is_oov: true,
          romanization: null,
          candidates: [],
        },
      ],
    });

    const total = await processTextNow('text-1');
    expect(total).toBe(2);

    const inserts = calls.filter((c) => c.kind === 'insert');
    // Two insert calls: one per chapter's tokens.
    expect(inserts).toHaveLength(2);
    const firstInsert = (inserts[0] as Extract<Call, { kind: 'insert' }>).values as Array<{
      lemmaId: string | null;
      surface: string;
      romanization: string | null;
    }>;
    expect(firstInsert[0]!.lemmaId).toBe('lemma-bolnaa');
    expect(firstInsert[0]!.romanization).toBe('bolnā');

    const secondInsert = (inserts[1] as Extract<Call, { kind: 'insert' }>).values as Array<{
      lemmaId: string | null;
      isOov: boolean;
    }>;
    expect(secondInsert[0]!.lemmaId).toBeNull();
    expect(secondInsert[0]!.isOov).toBe(true);

    // Two delete calls (one per chapter, idempotency clear before insert).
    expect(calls.filter((c) => c.kind === 'delete')).toHaveLength(2);
  });

  it('marks the text failed when the NLP service throws', async () => {
    stage([{ id: 'text-1', language: 'hi' }]);
    stage([{ id: 'chap-1', body: 'oops' }]);
    stage([]); // empty lemma map
    nlpProcess.mockRejectedValueOnce(new Error('NLP service 500'));

    await expect(processTextNow('text-1')).rejects.toThrow(/NLP service 500/);

    // texts.status update happened twice: once → processing, once → failed.
    const updates = calls.filter(
      (c): c is Extract<Call, { kind: 'update' }> => c.kind === 'update',
    );
    const failed = updates.find(
      (u) => (u.set as { status?: string }).status === 'failed',
    );
    expect(failed).toBeDefined();
    expect(
      (failed!.set as { statusError: string }).statusError,
    ).toMatch(/NLP service 500/);
  });
});
