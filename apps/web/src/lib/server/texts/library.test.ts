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
  // Empty when nothing's staged — e.g. the per-text reading-progress lookup,
  // which tests don't stage and which should just contribute no progress.
  return staged.shift() ?? [];
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

// T-7.5: listSharedTexts uses db.execute(sql`…`) for the
// shared-id union. Test stub returns the next staged result.
const executeFn = vi.fn(async () => {
  calls.push({ kind: 'select' });
  return staged.shift() ?? [];
});

vi.mock('../db/index.js', () => ({
  db: {
    select: () => selectFn(),
    execute: (...a: unknown[]) => executeFn(...(a as [])),
  },
  schema: {
    texts: {
      id: 'texts.id',
      ownerId: 'texts.owner_id',
      language: 'texts.language',
      visibility: 'texts.visibility',
      createdAt: 'texts.created_at',
    },
    userTextProgress: {
      userId: 'utp.user_id',
      textId: 'utp.text_id',
      pctRead: 'utp.pct_read',
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
  it('carries the viewer reading progress (pct_read) onto each card', async () => {
    stage([{ count: 1 }]); // count query
    stage([textRow({ id: 't1', status: 'ready' })]); // page rows
    stage([{ textId: 't1', pctRead: 42.7 }]); // per-text progress lookup (raw float)
    const page = await listOwnedTexts({ id: 'user-1' });
    expect(page.cards[0]?.progressPct).toBe(43); // rounded to a whole percent
  });

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
  it('returns an empty page when the viewer has no share rows', async () => {
    // Single SELECT against the share-tables UNION → no ids.
    stage([]);
    const page = await listSharedTexts({ id: 'user-1' });
    expect(page.cards).toEqual([]);
    expect(page.totalCount).toBe(0);
    // No follow-up SELECT against the texts table when the union
    // returned 0 ids.
    expect(calls).toHaveLength(1);
  });

  it('returns the texts the viewer has direct or group access to', async () => {
    stage([{ id: 't1' }, { id: 't2' }]); // share-id union
    stage([{ count: 2 }]); // count
    stage([textRow({ id: 't1' }), textRow({ id: 't2' })]); // rows
    const page = await listSharedTexts({ id: 'user-1' });
    expect(page.totalCount).toBe(2);
    expect(page.cards.map((c) => c.id)).toEqual(['t1', 't2']);
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
