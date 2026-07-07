// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Chain = Record<string, unknown>;
const staged: Array<unknown[] | { rows: unknown[] }> = [];
const calls: Array<{ kind: string; payload?: unknown; set?: unknown }> = [];

function stage(rows: unknown[] | { rows: unknown[] }) {
  staged.push(rows);
}

function next(): unknown[] | { rows: unknown[] } {
  const v = staged.shift();
  if (!v) throw new Error('Test bug: no staged result');
  return v;
}

function selectChain() {
  const chain: Chain = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) => resolve(next());
  return chain;
}

function insertChain() {
  const entry = { kind: 'insert', payload: undefined as unknown };
  calls.push(entry);
  const chain: Chain = {};
  chain.values = vi.fn((payload: unknown) => {
    entry.payload = payload;
    return chain;
  });
  chain.onConflictDoUpdate = vi.fn((patch: unknown) => {
    calls.push({ kind: 'upsert', set: patch });
    return Promise.resolve();
  });
  return chain;
}

function deleteChain() {
  calls.push({ kind: 'delete' });
  const chain: Chain = {};
  chain.where = vi.fn(() => Promise.resolve());
  return chain;
}

const execute = vi.fn((query?: unknown) => {
  void query;
  return next();
});

vi.mock('../db/index.js', () => ({
  db: {
    select: vi.fn(() => selectChain()),
    insert: vi.fn(() => insertChain()),
    delete: vi.fn(() => deleteChain()),
    execute: (query: unknown) => execute(query),
  },
  schema: {
    translations: {
      id: 'translations.id',
    },
    translationVotes: {
      userId: 'translation_votes.user_id',
      translationId: 'translation_votes.translation_id',
      value: 'translation_votes.value',
    },
  },
}));

const {
  getTranslationVoteSummary,
  setTranslationVote,
  TranslationVoteError,
} = await import('./votes.js');

function translation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tr-1',
    lemmaId: 'lemma-1',
    source: 'user',
    submittedBy: 'u2',
    parentTranslationId: null,
    body: 'community gloss',
    targetLanguage: 'en',
    sourceAttribution: null,
    sourceId: null,
    hidden: false,
    displayRank: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  staged.length = 0;
  calls.length = 0;
  execute.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('translation votes', () => {
  it('upserts a vote and returns the current score + viewer vote', async () => {
    stage([translation()]);
    stage({ rows: [{ score: 2 }] });
    stage([{ value: 'up' }]);

    const out = await setTranslationVote('u1', 'tr-1', 'up');

    expect(out).toEqual({ translationId: 'tr-1', score: 2, vote: 'up' });
    expect(calls.find((c) => c.kind === 'insert')?.payload).toMatchObject({
      userId: 'u1',
      translationId: 'tr-1',
      value: 'up',
    });
    expect(calls.some((c) => c.kind === 'upsert')).toBe(true);
  });

  it('clears a vote by deleting the row', async () => {
    stage([translation()]);
    stage({ rows: [{ score: 0 }] });
    stage([]);

    const out = await setTranslationVote('u1', 'tr-1', null);

    expect(out.vote).toBeNull();
    expect(calls.some((c) => c.kind === 'delete')).toBe(true);
  });

  it('rejects official translations', async () => {
    stage([translation({ source: 'official_dictionary', submittedBy: null })]);

    await expect(setTranslationVote('u1', 'tr-1', 'up')).rejects.toMatchObject({
      status: 403,
    });
  });

  it('rejects voting on your own translation', async () => {
    stage([translation({ submittedBy: 'u1' })]);

    await expect(setTranslationVote('u1', 'tr-1', 'down')).rejects.toBeInstanceOf(
      TranslationVoteError,
    );
  });

  it('rejects voting on a private translation', async () => {
    stage([translation({ isPrivate: true })]);

    await expect(setTranslationVote('u1', 'tr-1', 'up')).rejects.toMatchObject({
      status: 403,
    });
  });

  it('returns the current summary without writing', async () => {
    stage({ rows: [{ score: -1 }] });
    stage([{ value: 'down' }]);

    await expect(getTranslationVoteSummary('tr-1', 'u1')).resolves.toEqual({
      translationId: 'tr-1',
      score: -1,
      vote: 'down',
    });
  });
});
