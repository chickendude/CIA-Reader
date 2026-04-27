// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  chain.then = (resolve: (v: unknown) => unknown) => resolve(nextStaged());
  return chain;
}

const selectFn = vi.fn(() => makeSelectChain());

vi.mock('../db/index.js', () => ({
  db: { select: () => selectFn() },
  schema: {
    textTokens: {
      id: 'text_tokens.id',
      chapterId: 'text_tokens.chapter_id',
      idx: 'text_tokens.idx',
      lemmaId: 'text_tokens.lemma_id',
    },
    userKnownLemmas: {
      userId: 'user_known_lemmas.user_id',
      lemmaId: 'user_known_lemmas.lemma_id',
      status: 'user_known_lemmas.status',
    },
  },
}));

const { loadChapterTokens, loadKnownStatusMap, listKnownLemmas } =
  await import('./tokens.js');

beforeEach(() => {
  staged.length = 0;
  selectFn.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

function tokenRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tok-1',
    chapterId: 'chap-1',
    idx: 0,
    surface: 'पाठ',
    lemmaId: 'lem-1',
    lemmaCandidates: [],
    features: {},
    isAmbiguous: false,
    isOov: false,
    isWord: true,
    sentenceIdx: 0,
    romanization: null,
    ...overrides,
  };
}

describe('loadChapterTokens', () => {
  it('returns null when no tokens have been written for the chapter yet', async () => {
    stage([]);
    const result = await loadChapterTokens('chap-1', 'user-1');
    expect(result).toBeNull();
  });

  it('returns tokens with status=unknown when the viewer has no known-lemma rows', async () => {
    stage([tokenRow({ id: 't1', idx: 0 }), tokenRow({ id: 't2', idx: 1 })]);
    stage([]); // user_known_lemmas → empty
    const result = await loadChapterTokens('chap-1', 'user-1');
    expect(result).not.toBeNull();
    expect(result!.every((t) => t.status === 'unknown')).toBe(true);
  });

  it('joins user_known_lemmas to colour matching lemmas', async () => {
    stage([
      tokenRow({ id: 't1', idx: 0, lemmaId: 'lem-known' }),
      tokenRow({ id: 't2', idx: 1, lemmaId: 'lem-learning' }),
      tokenRow({ id: 't3', idx: 2, lemmaId: 'lem-other' }),
    ]);
    stage([
      { userId: 'user-1', lemmaId: 'lem-known', status: 'known' },
      { userId: 'user-1', lemmaId: 'lem-learning', status: 'learning' },
    ]);
    const result = await loadChapterTokens('chap-1', 'user-1');
    expect(result).toEqual([
      expect.objectContaining({ id: 't1', status: 'known' }),
      expect.objectContaining({ id: 't2', status: 'learning' }),
      expect.objectContaining({ id: 't3', status: 'unknown' }),
    ]);
  });

  it('handles anonymous viewers (no second SELECT, every status=unknown)', async () => {
    stage([tokenRow({ id: 't1', idx: 0 })]);
    const result = await loadChapterTokens('chap-1', null);
    expect(result).not.toBeNull();
    expect(result![0]!.status).toBe('unknown');
    // Only ONE SELECT — the user_known_lemmas query was skipped.
    expect(selectFn).toHaveBeenCalledTimes(1);
  });
});

describe('loadKnownStatusMap', () => {
  it('returns an empty map for anonymous callers', async () => {
    const map = await loadKnownStatusMap(null, ['l1']);
    expect(map.size).toBe(0);
    expect(selectFn).not.toHaveBeenCalled();
  });

  it('returns an empty map when no lemma ids are requested', async () => {
    const map = await loadKnownStatusMap('user-1', []);
    expect(map.size).toBe(0);
    expect(selectFn).not.toHaveBeenCalled();
  });

  it('filters server-returned rows down to the requested lemma id set', async () => {
    stage([
      { userId: 'user-1', lemmaId: 'l1', status: 'known' },
      { userId: 'user-1', lemmaId: 'l2', status: 'learning' },
      { userId: 'user-1', lemmaId: 'l3', status: 'ignored' },
    ]);
    const map = await loadKnownStatusMap('user-1', ['l1', 'l3']);
    expect(map.get('l1')).toBe('known');
    expect(map.get('l3')).toBe('ignored');
    expect(map.has('l2')).toBe(false);
  });
});

describe('listKnownLemmas', () => {
  it('returns every known-lemma row for the user when no status filter is passed', async () => {
    stage([
      { userId: 'user-1', lemmaId: 'l1', status: 'known' },
      { userId: 'user-1', lemmaId: 'l2', status: 'learning' },
    ]);
    const rows = await listKnownLemmas('user-1');
    expect(rows).toHaveLength(2);
  });
});
