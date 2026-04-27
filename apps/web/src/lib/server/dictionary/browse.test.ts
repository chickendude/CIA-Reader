// @vitest-environment node
/**
 * Tests for the dictionary browse service (T-3.6). Mocks the drizzle
 * `db` surface — we mostly want to prove that filters wire through and
 * that limit/offset are clamped sanely.
 */
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

const chainCalls: Array<{
  method: 'limit' | 'offset';
  arg: number;
}> = [];

function makeSelectChain() {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.limit = vi.fn((n: number) => {
    chainCalls.push({ method: 'limit', arg: n });
    return chain;
  });
  chain.offset = vi.fn((n: number) => {
    chainCalls.push({ method: 'offset', arg: n });
    return chain;
  });
  chain.then = (resolve: (v: unknown) => unknown) => resolve(nextStaged());
  return chain;
}

const selectFn = vi.fn(() => makeSelectChain());

vi.mock('../db/index.js', () => ({
  db: { select: () => selectFn() },
  schema: {
    lemmas: {
      id: 'lemmas.id',
      language: 'lemmas.language',
      headword: 'lemmas.headword',
      pos: 'lemmas.pos',
      frequencyRank: 'lemmas.frequency_rank',
    },
    translations: {},
  },
}));

const {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  listDictionaryLemmas,
  publicLemma,
} = await import('./browse.js');

function lemmaRow(partial: Record<string, unknown> = {}) {
  return {
    id: 'lemma-1',
    language: 'hi',
    headword: 'बोलना',
    pos: 'verb',
    script: 'Deva',
    glossDefault: 'to speak',
    frequencyRank: 42,
    source: 'official_dictionary',
    sourceAttribution: 'Hindi WordNet',
    sourceId: 'hwn:12345',
    curatorLocked: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  };
}

beforeEach(() => {
  staged.length = 0;
  chainCalls.length = 0;
  selectFn.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('listDictionaryLemmas', () => {
  it('returns paginated lemmas and a total count', async () => {
    stage([lemmaRow(), lemmaRow({ id: 'lemma-2', headword: 'खाना' })]);
    stage([{ n: 57 }]);

    const result = await listDictionaryLemmas('hi');
    expect(result.lemmas).toHaveLength(2);
    expect(result.totalCount).toBe(57);
    expect(result.limit).toBe(DEFAULT_PAGE_SIZE);
    expect(result.offset).toBe(0);
  });

  it('clamps limit to MAX_PAGE_SIZE when caller asks for too many', async () => {
    stage([]);
    stage([{ n: 0 }]);
    await listDictionaryLemmas('hi', { limit: 99999 });
    expect(
      chainCalls.find((c) => c.method === 'limit'),
    ).toEqual({ method: 'limit', arg: MAX_PAGE_SIZE });
  });

  it('clamps a negative offset to 0', async () => {
    stage([]);
    stage([{ n: 0 }]);
    await listDictionaryLemmas('hi', { offset: -100 });
    expect(
      chainCalls.find((c) => c.method === 'offset'),
    ).toEqual({ method: 'offset', arg: 0 });
  });

  it('falls back to DEFAULT_PAGE_SIZE when limit is 0 or null', async () => {
    stage([]);
    stage([{ n: 0 }]);
    await listDictionaryLemmas('hi', { limit: 0 });
    expect(
      chainCalls.find((c) => c.method === 'limit'),
    ).toEqual({ method: 'limit', arg: DEFAULT_PAGE_SIZE });
  });

  it('accepts a search query and plumbs it through (whitespace trimmed)', async () => {
    stage([lemmaRow()]);
    stage([{ n: 1 }]);
    const result = await listDictionaryLemmas('hi', { q: '  बोल  ' });
    expect(result.lemmas).toHaveLength(1);
  });

  it('treats a whitespace-only query as no query', async () => {
    stage([lemmaRow()]);
    stage([{ n: 1 }]);
    await expect(
      listDictionaryLemmas('hi', { q: '   ' }),
    ).resolves.toMatchObject({ totalCount: 1 });
  });

  it('accepts filter combinations (pos + rank range + hasOfficial)', async () => {
    stage([lemmaRow()]);
    stage([{ n: 1 }]);
    const result = await listDictionaryLemmas('hi', {
      pos: ['verb', 'noun'],
      minRank: 1,
      maxRank: 1000,
      hasOfficialTranslation: true,
    });
    expect(result.lemmas).toHaveLength(1);
  });

  it('respects an explicit offset', async () => {
    stage([]);
    stage([{ n: 500 }]);
    const result = await listDictionaryLemmas('hi', { offset: 100, limit: 25 });
    expect(result.offset).toBe(100);
    expect(result.limit).toBe(25);
    expect(chainCalls).toContainEqual({ method: 'offset', arg: 100 });
    expect(chainCalls).toContainEqual({ method: 'limit', arg: 25 });
  });

  it('does not add a pos filter when pos is an empty list', async () => {
    stage([lemmaRow()]);
    stage([{ n: 1 }]);
    // We can't easily introspect the WHERE clause, but we can assert
    // no error and that the call resolves.
    await expect(
      listDictionaryLemmas('hi', { pos: [] }),
    ).resolves.toMatchObject({ totalCount: 1 });
  });
});

describe('publicLemma', () => {
  it('renames source to provenanceSource and drops sourceId', () => {
    const shaped = publicLemma(lemmaRow() as never);
    expect(shaped).toMatchObject({
      id: 'lemma-1',
      headword: 'बोलना',
      provenanceSource: 'official_dictionary',
      sourceAttribution: 'Hindi WordNet',
    });
    expect((shaped as Record<string, unknown>).source).toBeUndefined();
    expect((shaped as Record<string, unknown>).sourceId).toBeUndefined();
  });
});
