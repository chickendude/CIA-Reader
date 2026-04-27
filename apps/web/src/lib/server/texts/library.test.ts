// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Call =
  | { kind: 'select' }
  | { kind: 'select-count' };
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
  chain.offset = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) => resolve(nextStaged());
  return chain;
}

const selectFn = vi.fn(() => {
  calls.push({ kind: 'select' });
  return makeSelectChain();
});

vi.mock('../db/index.js', () => ({
  db: {
    select: () => selectFn(),
  },
  schema: {
    texts: {
      id: 'texts.id',
      ownerId: 'texts.owner_id',
      language: 'texts.language',
      visibility: 'texts.visibility',
      createdAt: 'texts.created_at',
    },
  },
}));

const {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  listOwnedTexts,
  listSharedTexts,
  listOfficialTexts,
} = await import('./library.js');

function textRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    ownerId: 'user-1',
    language: 'hi',
    title: 'Sample',
    sourceType: 'paste',
    status: 'pending',
    visibility: 'private',
    statusError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  calls.length = 0;
  staged.length = 0;
  selectFn.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('listOwnedTexts', () => {
  it('returns page + total + clamped pagination defaults', async () => {
    stage([{ count: 7 }]); // count query
    stage([textRow(), textRow({ id: 't2' })]); // page rows
    const page = await listOwnedTexts({ id: 'user-1' });
    expect(page.totalCount).toBe(7);
    expect(page.cards).toHaveLength(2);
    expect(page.limit).toBe(DEFAULT_PAGE_SIZE);
    expect(page.offset).toBe(0);
  });

  it('clamps a limit above MAX_PAGE_SIZE', async () => {
    stage([{ count: 0 }]);
    stage([]);
    const page = await listOwnedTexts(
      { id: 'user-1' },
      { limit: 5_000, offset: -10 },
    );
    expect(page.limit).toBe(MAX_PAGE_SIZE);
    expect(page.offset).toBe(0);
  });

  it('passes a language filter through', async () => {
    stage([{ count: 0 }]);
    stage([]);
    const page = await listOwnedTexts(
      { id: 'user-1' },
      { language: 'or' },
    );
    expect(page.cards).toEqual([]);
    // Two SELECTs (count + rows).
    expect(calls).toHaveLength(2);
  });
});

describe('listSharedTexts', () => {
  it('returns an empty page (M7 not yet wired)', async () => {
    const page = await listSharedTexts({ id: 'user-1' });
    expect(page.cards).toEqual([]);
    expect(page.totalCount).toBe(0);
    // No DB hit at all in the stub.
    expect(calls).toHaveLength(0);
  });
});

describe('listOfficialTexts', () => {
  it('queries by visibility=official with no auth required', async () => {
    stage([{ count: 3 }]);
    stage([
      textRow({ id: 't1', visibility: 'official' }),
      textRow({ id: 't2', visibility: 'official' }),
    ]);
    const page = await listOfficialTexts();
    expect(page.totalCount).toBe(3);
    expect(page.cards.every((c) => c.visibility === 'official')).toBe(true);
  });

  it('honors a language filter', async () => {
    stage([{ count: 0 }]);
    stage([]);
    const page = await listOfficialTexts({ language: 'mr' });
    expect(page.cards).toEqual([]);
  });
});
