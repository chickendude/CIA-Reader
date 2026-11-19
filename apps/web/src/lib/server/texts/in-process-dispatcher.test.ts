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
    transaction: (fn: (tx: unknown) => unknown) => fn({ insert: insertFn, delete: deleteFn }),
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
  },
}));

const nlpProcess = vi.fn();
vi.mock('../nlp-client.js', () => ({
  nlpClient: { process: (...a: unknown[]) => nlpProcess(...a) },
}));

// stub the phrase-span resolver so existing dispatcher
// tests don't have to stage extra DB calls. The hook itself is
// covered by `phrase-spans.test.ts` (rebuild + loader) and the
// `'rebuilds chapter phrase spans after writing text_tokens'` case
// at the bottom of this file.
const rebuildChapterSpans = vi.fn();
vi.mock('./phrase-spans.js', () => ({
  rebuildChapterSpans: (...a: unknown[]) => rebuildChapterSpans(...a),
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
  rebuildChapterSpans.mockReset();
  rebuildChapterSpans.mockResolvedValue(0);
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
          number_forms: {
            value: '123',
            digits_latin: '123',
            digits_deva: '१२३',
            digits_orya: '୧୨୩',
            hi: { spelled: 'एक सौ तेईस', romanized: 'ek sau teīs' },
            mr: { spelled: 'एकशे तेवीस', romanized: 'ēkaśē tēvīsa' },
            odia: { spelled: 'ଏକ ଶହ ତେଇଶ', romanized: 'ēka śaha tēiśa' },
            eu: { spelled: 'ehun eta hogeita hiru', romanized: '' },
          },
          candidates: [
            { dictionary_id: 'lemma-bolnaa', lemma: 'बोलना', pos: 'verb', score: 0.9, features: { Tense: 'Pres' } },
            { dictionary_id: 'lemma-other', lemma: 'बोल', pos: 'noun', score: 1, features: {} },
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
          candidates: [{ lemma: 'unknown', pos: 'X', score: 1, features: {} }],
          number_forms: null,
        },
      ],
    });

    const progress = vi.fn();
    const total = await processTextNow('text-1', progress);
    expect(progress.mock.calls).toEqual([[0, 2], [1, 2], [2, 2]]);
    expect(total).toBe(2);

    const inserts = calls.filter((c) => c.kind === 'insert');
    // Two insert calls: one per chapter's tokens.
    expect(inserts).toHaveLength(2);
    const firstInsert = (inserts[0] as Extract<Call, { kind: 'insert' }>).values as Array<{
      lemmaId: string | null;
      surface: string;
      romanization: string | null;
      numberForms: { value: string } | null;
    }>;
    expect(firstInsert[0]!.lemmaId).toBe('lemma-bolnaa');
    expect(firstInsert[0]).toMatchObject({
      isAmbiguous: true,
      features: { Tense: 'Pres' },
      lemmaCandidates: [
        { lemmaId: 'lemma-bolnaa', features: { Tense: 'Pres' } },
        { lemmaId: 'lemma-other', features: {} },
      ],
    });
    expect(firstInsert[0]!.romanization).toBe('bolnā');
    expect(firstInsert[0]!.numberForms?.value).toBe('123');

    const secondInsert = (inserts[1] as Extract<Call, { kind: 'insert' }>).values as Array<{
      lemmaId: string | null;
      isOov: boolean;
      numberForms: unknown;
    }>;
    expect(secondInsert[0]!.lemmaId).toBeNull();
    expect(secondInsert[0]!.isOov).toBe(true);
    expect(secondInsert[0]!.numberForms).toBeNull();

    // Two delete calls (one per chapter, idempotency clear before insert).
    expect(calls.filter((c) => c.kind === 'delete')).toHaveLength(2);
  });

  it('marks the text failed when the NLP service throws', async () => {
    stage([{ id: 'text-1', language: 'hi' }]);
    stage([{ id: 'chap-1', body: 'oops' }]);
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

  it('rebuilds chapter phrase spans after writing text_tokens', async () => {
    stage([{ id: 'text-1', language: 'hi' }]); // text lookup
    stage([{ id: 'chap-1', body: 'one' }]); // chapters

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
          number_forms: null,
          candidates: [
            { dictionary_id: 'lemma-bolnaa', lemma: 'बोलना', pos: 'verb', score: 0.9, features: {} },
          ],
        },
      ],
    });

    await processTextNow('text-1');
    expect(rebuildChapterSpans).toHaveBeenCalledTimes(1);
    expect(rebuildChapterSpans).toHaveBeenCalledWith({
      chapterId: 'chap-1',
      language: 'hi',
    });
  });
});
