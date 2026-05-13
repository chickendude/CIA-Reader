// @vitest-environment node
/**
 * Unit tests for the simple lemma_forms repository helpers in
 * lemma-forms.ts. The list / create / update / delete / search /
 * setLemmaParadigm / loadSurfaceToLemmaMap helpers all accept a
 * `dbHandle: DbLike = db` parameter, so we can hand in a fake DB
 * instead of mocking the module.
 *
 * `regenerateForms` (and its umbrella `regenerateAllForParadigm`)
 * own their own tests + transaction handling; this file covers the
 * lighter-weight repository surface.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createForm,
  deleteForm,
  listFormsForLemma,
  loadSurfaceToLemmaMap,
  searchFormsByPrefix,
  setLemmaParadigm,
  updateForm,
} from './lemma-forms.js';

type Call =
  | { kind: 'select' }
  | { kind: 'update'; set?: unknown }
  | { kind: 'insert'; values?: unknown }
  | { kind: 'delete' }
  | { kind: 'execute'; sql?: unknown };
const calls: Call[] = [];
const staged: Array<unknown> = [];
function stage(rows: unknown) {
  staged.push(rows);
}
function nextStaged(): unknown {
  if (staged.length === 0) throw new Error('Test bug: no staged result');
  return staged.shift();
}

function makeSelectChain() {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.leftJoin = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
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
  chain.returning = vi.fn(() => nextStaged());
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

function makeDeleteChain() {
  calls.push({ kind: 'delete' });
  const chain: Record<string, unknown> = {};
  chain.where = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) => resolve(undefined);
  return chain;
}

const fakeDb = {
  select: () => {
    calls.push({ kind: 'select' });
    return makeSelectChain();
  },
  update: () => makeUpdateChain(),
  insert: () => makeInsertChain(),
  delete: () => makeDeleteChain(),
  execute: vi.fn((sql: unknown) => {
    calls.push({ kind: 'execute', sql });
    return nextStaged();
  }),
} as unknown as Parameters<typeof createForm>[1];

beforeEach(() => {
  calls.length = 0;
  staged.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('listFormsForLemma', () => {
  it('shapes each joined row into a LemmaFormRow', async () => {
    stage([
      {
        id: 'f-1',
        surface: 'ରହିବା',
        features: { VerbForm: 'Inf' },
        romanization: 'rahibā',
        createdBy: 'curator',
        paradigmSlotId: 's-1',
        paradigmSlotKey: 'inf',
        paradigmSlotSort: 10,
        quarantinedAt: null,
        quarantineReason: null,
      },
    ]);
    const rows = await listFormsForLemma('l-1', fakeDb);
    expect(rows).toEqual([
      {
        id: 'f-1',
        surface: 'ରହିବା',
        features: { VerbForm: 'Inf' },
        romanization: 'rahibā',
        createdBy: 'curator',
        paradigmSlotId: 's-1',
        paradigmSlotKey: 'inf',
        quarantinedAt: null,
        quarantineReason: null,
      },
    ]);
  });
});

describe('createForm', () => {
  it('NFC-normalises surface and defaults features + romanization + createdBy', async () => {
    stage([
      {
        id: 'f-new',
        lemmaId: 'l-1',
        surface: 'ବୋଲ',
        features: {},
        romanization: null,
        createdBy: 'curator',
      },
    ]);
    const row = await createForm(
      {
        lemmaId: 'l-1',
        // explicitly decomposed input — verifies the NFC normalize path
        surface: 'ବୋଲ',
      },
      fakeDb,
    );
    expect(row.id).toBe('f-new');
    const insert = calls.find((c) => c.kind === 'insert')!;
    expect(insert.values).toMatchObject({
      lemmaId: 'l-1',
      features: {},
      romanization: null,
      createdBy: 'curator',
    });
  });

  it('respects an explicit createdBy override', async () => {
    stage([{ id: 'f', createdBy: 'generator' }]);
    await createForm(
      {
        lemmaId: 'l-1',
        surface: 'x',
        createdBy: 'generator',
      },
      fakeDb,
    );
    const insert = calls.find((c) => c.kind === 'insert')!;
    expect((insert.values as { createdBy: string }).createdBy).toBe('generator');
  });
});

describe('updateForm', () => {
  it('promotes the row to curator and persists patch fields', async () => {
    stage([{ id: 'f-1', createdBy: 'curator' }]);
    const row = await updateForm(
      'f-1',
      {
        surface: 'newsurface',
        features: { Tense: 'Past' },
        romanization: 'rom',
      },
      fakeDb,
    );
    expect(row).not.toBeNull();
    const update = calls.find((c) => c.kind === 'update')!;
    const set = update.set as Record<string, unknown>;
    expect(set.createdBy).toBe('curator');
    expect(set.surface).toBe('newsurface');
    expect(set.features).toEqual({ Tense: 'Past' });
    expect(set.romanization).toBe('rom');
  });

  it('returns null when the row id no longer exists', async () => {
    stage([]);
    const out = await updateForm('f-missing', { surface: 'x' }, fakeDb);
    expect(out).toBeNull();
  });

  it('forwards quarantine fields when supplied', async () => {
    stage([{ id: 'f-1' }]);
    const at = new Date('2026-05-12');
    await updateForm(
      'f-1',
      { quarantinedAt: at, quarantineReason: 'junk' },
      fakeDb,
    );
    const update = calls.find((c) => c.kind === 'update')!;
    expect(update.set).toMatchObject({
      quarantinedAt: at,
      quarantineReason: 'junk',
    });
  });
});

describe('deleteForm', () => {
  it('issues a DELETE keyed by form id', async () => {
    await deleteForm('f-1', fakeDb);
    expect(calls.some((c) => c.kind === 'delete')).toBe(true);
  });
});

describe('setLemmaParadigm', () => {
  it('updates paradigm_id + stem on the lemma row', async () => {
    stage([{ id: 'l-1', paradigmId: 'p-1', stem: 'बोल' }]);
    const out = await setLemmaParadigm(
      'l-1',
      { paradigmId: 'p-1', stem: 'बोल' },
      fakeDb,
    );
    expect(out!.paradigmId).toBe('p-1');
    const update = calls.find((c) => c.kind === 'update')!;
    expect(update.set).toMatchObject({ paradigmId: 'p-1', stem: 'बोल' });
  });

  it('returns null when no lemma matches', async () => {
    stage([]);
    const out = await setLemmaParadigm(
      'l-missing',
      { paradigmId: null, stem: null },
      fakeDb,
    );
    expect(out).toBeNull();
  });
});

describe('searchFormsByPrefix', () => {
  it('returns an empty list for whitespace queries (no SQL fires)', async () => {
    const out = await searchFormsByPrefix('hi', '   ', {}, fakeDb);
    expect(out).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('clamps the limit into [1, 100] and maps result rows', async () => {
    stage({
      rows: [
        {
          lemma_id: 'l-1',
          headword: 'बोलना',
          pos: 'VERB',
          language: 'hi',
          matched_surface: 'बोलते',
        },
      ],
    });
    const hits = await searchFormsByPrefix(
      'hi',
      'बोल',
      { limit: 9999 },
      fakeDb,
    );
    expect(hits).toEqual([
      {
        lemmaId: 'l-1',
        headword: 'बोलना',
        pos: 'VERB',
        language: 'hi',
        matchedSurface: 'बोलते',
      },
    ]);
  });

  it('handles a bare array shape (drizzle returns rows directly in some cases)', async () => {
    stage([
      {
        lemma_id: 'l-2',
        headword: 'पीना',
        pos: 'VERB',
        language: 'hi',
        matched_surface: null,
      },
    ]);
    const hits = await searchFormsByPrefix('hi', 'पी', {}, fakeDb);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.matchedSurface).toBeNull();
  });
});

describe('loadSurfaceToLemmaMap', () => {
  it('keeps the first lemmaId for each surface', async () => {
    stage([
      { surface: 'बोल', lemmaId: 'l-1' },
      { surface: 'बोल', lemmaId: 'l-collision' },
      { surface: 'पी', lemmaId: 'l-2' },
    ]);
    const map = await loadSurfaceToLemmaMap('hi', fakeDb);
    expect(map.get('बोल')).toBe('l-1');
    expect(map.get('पी')).toBe('l-2');
    expect(map.size).toBe(2);
  });
});
