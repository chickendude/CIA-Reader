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
  // ensureLemma() chains on these for upsert-style auto-create.
  chain.onConflictDoNothing = vi.fn(() => chain);
  chain.returning = vi.fn(() => nextStaged());
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
    formLemmaOverrides: {
      surfaceNfc: 'form_lemma_overrides.surface_nfc',
      chosenLemmaId: 'form_lemma_overrides.chosen_lemma_id',
      contextSignature: 'form_lemma_overrides.context_signature',
      language: 'form_lemma_overrides.language',
    },
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
    // form_lemma_overrides preload (T-2.7) — empty for this test.
    stage([]);

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

  it('auto-creates a lemma row when Stanza returns an unrecognized headword', async () => {
    // text + chapters + empty lemma index
    stage([{ id: 'text-1', language: 'hi' }]);
    stage([{ id: 'chap-1', body: 'unfamiliar word' }]);
    stage([]); // lemma index — no rows
    stage([]); // form_lemma_overrides — no rows
    // ensureLemma's onConflictDoNothing(...).returning() chain
    // pulls one staged row.
    stage([{ id: 'lemma-new', headword: 'नमस्ते', pos: 'INTJ' }]);

    nlpProcess.mockResolvedValueOnce({
      language: 'hi',
      pipeline_id: 'stanza-hi',
      tokens: [
        {
          idx: 0,
          surface: 'नमस्ते',
          is_word: true,
          is_ambiguous: false,
          // Stanza's OOV heuristic flags `lemma==surface` as OOV; the
          // dispatcher should still auto-create + flip isOov=false
          // because we now have a dictionary row to attach to.
          is_oov: true,
          romanization: 'namaste',
          candidates: [
            { lemma: 'नमस्ते', pos: 'INTJ', score: 1.0, features: {} },
          ],
        },
      ],
    });

    await processTextNow('text-1');

    // First insert is the auto-created lemma row (ensureLemma); second
    // is the text_tokens batch.
    const inserts = calls.filter(
      (c): c is Extract<Call, { kind: 'insert' }> => c.kind === 'insert',
    );
    expect(inserts).toHaveLength(2);
    expect(inserts[0]!.values).toMatchObject({
      language: 'hi',
      headword: 'नमस्ते',
      pos: 'INTJ',
      script: 'Deva',
      sourceAttribution: 'Stanza UD',
    });
    const tokenInsert = inserts[1]!.values as Array<{
      lemmaId: string | null;
      isOov: boolean;
    }>;
    expect(tokenInsert[0]!.lemmaId).toBe('lemma-new');
    // Token had is_oov=true from the worker, but the auto-created
    // lemma row makes "no dictionary match" no longer correct.
    expect(tokenInsert[0]!.isOov).toBe(false);
  });

  it('honors a form_lemma_overrides row over the Stanza candidate (T-2.7)', async () => {
    stage([{ id: 'text-1', language: 'hi' }]);
    stage([{ id: 'chap-1', body: 'वह है।' }]);
    // lemma index: होना already exists in the dictionary.
    stage([{ id: 'lemma-hona', headword: 'होना', pos: 'VERB' }]);
    // form_lemma_overrides: surface 'है' → lemma-hona, wildcard ctx.
    stage([
      {
        surfaceNfc: 'है',
        chosenLemmaId: 'lemma-hona',
        contextSignature: '',
      },
    ]);

    nlpProcess.mockResolvedValueOnce({
      language: 'hi',
      pipeline_id: 'stanza-hi',
      tokens: [
        {
          idx: 0,
          surface: 'है',
          is_word: true,
          is_ambiguous: false,
          is_oov: false,
          romanization: 'hai',
          // Stanza's wrong guess: lemmatizes finite copula to itself.
          candidates: [
            { lemma: 'है', pos: 'AUX', score: 1.0, features: {} },
          ],
        },
      ],
    });

    await processTextNow('text-1');

    const inserts = calls.filter(
      (c): c is Extract<Call, { kind: 'insert' }> => c.kind === 'insert',
    );
    // No lemma auto-create — the override winning skips ensureLemma.
    // Only insert is the text_tokens batch.
    expect(inserts).toHaveLength(1);
    const tokenInsert = inserts[0]!.values as Array<{
      lemmaId: string | null;
      surface: string;
    }>;
    // The token's lemma_id is the override target, not Stanza's
    // self-lemmatization.
    expect(tokenInsert[0]!.lemmaId).toBe('lemma-hona');
    expect(tokenInsert[0]!.surface).toBe('है');
  });

  it('marks the text failed when the NLP service throws', async () => {
    stage([{ id: 'text-1', language: 'hi' }]);
    stage([{ id: 'chap-1', body: 'oops' }]);
    stage([]); // empty lemma map
    stage([]); // empty form_lemma_overrides
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
