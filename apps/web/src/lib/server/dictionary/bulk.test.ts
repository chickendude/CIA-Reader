// @vitest-environment node
/**
 * Unit tests for the bulk curator tools (T-3.9).
 *
 * Mirrors the staged-mock pattern from `curator.test.ts`:
 *   - Each DB call (`select`, `update`, `insert`, `delete`) returns a
 *     thenable chain that resolves the next staged result.
 *   - Tests `stage(rows)` the rows each SELECT/UPDATE/INSERT will see,
 *     in call order, then assert via the recorded `calls` log.
 *
 * Permission model is simple: every function is admin-only. We test
 * (a) that admin happy paths succeed, (b) that curator/user editors are
 * rejected up-front (no DB calls), (c) that empty / over-cap inputs
 * raise CuratorValidationError, (d) that per-row skips are reported in
 * the result, and (e) that every successful row writes one
 * `lemma_edit_history` audit row tagged with the bulk discriminator.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Call =
  | { kind: 'select' }
  | { kind: 'update'; set?: unknown; where?: unknown }
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
  chain.where = vi.fn((w: unknown) => {
    entry.where = w;
    return chain;
  });
  chain.returning = vi.fn(() => nextStaged());
  // Bulk attribution update doesn't call .returning() — resolve to undefined.
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
    lemmas: {
      id: 'lemmas.id',
      language: 'lemmas.language',
      headword: 'lemmas.headword',
      pos: 'lemmas.pos',
    },
    translations: {
      id: 'translations.id',
      targetType: 'translations.target_type',
      targetId: 'translations.target_id',
      source: 'translations.source',
      sourceAttribution: 'translations.source_attribution',
    },
    lemmaEditHistory: {
      id: 'lemma_edit_history.id',
      lemmaId: 'lemma_edit_history.lemma_id',
    },
  },
}));

const {
  bulkImportTranslations,
  bulkPromoteTranslations,
  bulkUpdateAttribution,
  BULK_LIMIT,
} = await import('./bulk.js');
const { CuratorValidationError } = await import('./curator.js');
const { ForbiddenError } = await import('./permissions.js');

const ADMIN = { id: 'admin-1', role: 'admin' as const };
const CURATOR = { id: 'cur-1', role: 'curator' as const };
const USER = { id: 'usr-1', role: 'user' as const };

function lemmaRow(overrides: Record<string, unknown> = {}) {
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
    sourceId: null,
    curatorLocked: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function translationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tr-1',
    // T-14.7a: legacy lemma_id field dropped — fixtures now
    // carry only the polymorphic (target_type, target_id)
    // pair. Bulk operations remain lemma-target-only; phrase
    // bulk paths land in a follow-up under T-14.4a.
    targetType: 'lemma',
    targetId: 'lemma-1',
    source: 'user',
    submittedBy: 'user-42',
    parentTranslationId: null,
    body: 'to speak',
    targetLanguage: 'en',
    sourceAttribution: null,
    sourceId: null,
    hidden: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  calls.length = 0;
  staged.length = 0;
  selectFn.mockClear();
  updateFn.mockClear();
  insertFn.mockClear();
  deleteFn.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

// -----------------------------------------------------------------------
// bulkImportTranslations
// -----------------------------------------------------------------------

describe('bulkImportTranslations', () => {
  it('rejects non-admins before touching the DB', async () => {
    await expect(
      bulkImportTranslations(
        CURATOR,
        [{ language: 'hi', headword: 'बोलना', pos: 'verb', body: 'to speak' }],
        'curator import attempt',
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      bulkImportTranslations(
        USER,
        [{ language: 'hi', headword: 'बोलना', pos: 'verb', body: 'to speak' }],
        'user import attempt',
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(calls).toHaveLength(0);
  });

  it('rejects an empty rows[] with a validation error', async () => {
    await expect(
      bulkImportTranslations(ADMIN, [], 'no rows'),
    ).rejects.toBeInstanceOf(CuratorValidationError);
  });

  it('rejects a missing reason', async () => {
    await expect(
      bulkImportTranslations(
        ADMIN,
        [{ language: 'hi', headword: 'बोलना', pos: 'verb', body: 'to speak' }],
        '  ',
      ),
    ).rejects.toBeInstanceOf(CuratorValidationError);
  });

  it('rejects more than BULK_LIMIT rows', async () => {
    const rows = Array.from({ length: BULK_LIMIT + 1 }, () => ({
      language: 'hi',
      headword: 'बोलना',
      pos: 'verb',
      body: 'to speak',
    }));
    await expect(
      bulkImportTranslations(ADMIN, rows, 'too many'),
    ).rejects.toBeInstanceOf(CuratorValidationError);
  });

  it('inserts a happy-path row and writes one audit', async () => {
    stage([lemmaRow()]); // lemma lookup
    const created = translationRow({
      id: 'tr-new',
      source: 'curator',
      submittedBy: ADMIN.id,
      body: 'to speak',
      sourceAttribution: 'Custom CSV 2026',
    });
    stage([created]); // insert .returning
    stage([{ id: 'hist-1' }]); // audit insert .returning

    const result = await bulkImportTranslations(
      ADMIN,
      [
        {
          language: 'hi',
          headword: 'बोलना',
          pos: 'verb',
          body: 'to speak',
          sourceAttribution: 'Custom CSV 2026',
        },
      ],
      'Importing curator gloss CSV',
    );

    expect(result.inserted).toBe(1);
    expect(result.skipped).toEqual([]);
    const insertCalls = calls.filter(
      (c): c is Extract<Call, { kind: 'insert' }> => c.kind === 'insert',
    );
    // 1 translation insert + 1 audit insert.
    expect(insertCalls).toHaveLength(2);
    const trInsert = insertCalls[0]!;
    // T-14.7a: bulk-import inserts now write the polymorphic
    // (target_type, target_id) pair instead of the legacy
    // lemma_id column.
    expect(trInsert.values).toMatchObject({
      targetType: 'lemma',
      targetId: 'lemma-1',
      source: 'curator',
      submittedBy: ADMIN.id,
      body: 'to speak',
      targetLanguage: 'en',
      sourceAttribution: 'Custom CSV 2026',
    });
    const auditInsert = insertCalls[1]!;
    expect(auditInsert.values).toMatchObject({
      // The audit row's `lemma_id` column on lemma_edit_history
      // is unaffected by T-14.7a — only translations.lemma_id
      // was dropped.
      lemmaId: 'lemma-1',
      editorId: ADMIN.id,
      changeType: 'translation_insert',
    });
    const change = (auditInsert.values as { change: Record<string, unknown> }).change;
    expect(change).toMatchObject({
      translationId: 'tr-new',
      bulkImportRow: 1,
      before: null,
    });
  });

  it('falls back to the per-call default attribution when a row omits it', async () => {
    stage([lemmaRow()]);
    stage([translationRow({ id: 'tr-x', sourceAttribution: 'Dflt 2026' })]);
    stage([{ id: 'hist-1' }]);

    const result = await bulkImportTranslations(
      ADMIN,
      [{ language: 'hi', headword: 'बोलना', pos: 'verb', body: 'to speak' }],
      'use default attribution',
      { sourceAttribution: 'Dflt 2026' },
    );
    expect(result.inserted).toBe(1);
    const trInsert = calls.find(
      (c): c is Extract<Call, { kind: 'insert' }> => c.kind === 'insert',
    )!;
    expect(
      (trInsert.values as { sourceAttribution: string | null }).sourceAttribution,
    ).toBe('Dflt 2026');
  });

  it('skips rows with unsupported languages, empty fields, oversize bodies, bad targetLanguage, and missing lemmas', async () => {
    // Row 1: unsupported language → skip (no DB call).
    // Row 2: empty headword → skip.
    // Row 3: empty pos → skip.
    // Row 4: empty body → skip.
    // Row 5: body over MAX_BODY_LEN → skip.
    // Row 6: invalid targetLanguage → skip.
    // Row 7: lemma not found (SELECT returns []) → skip.
    // Row 8: happy path.
    stage([]); // row 7 lookup → not found
    stage([lemmaRow()]); // row 8 lookup
    stage([translationRow({ id: 'tr-ok' })]); // row 8 insert
    stage([{ id: 'hist-1' }]); // row 8 audit

    const result = await bulkImportTranslations(
      ADMIN,
      [
        { language: 'xx', headword: 'x', pos: 'verb', body: 'x' },
        { language: 'hi', headword: '   ', pos: 'verb', body: 'x' },
        { language: 'hi', headword: 'बोलना', pos: '', body: 'x' },
        { language: 'hi', headword: 'बोलना', pos: 'verb', body: '' },
        {
          language: 'hi',
          headword: 'बोलना',
          pos: 'verb',
          body: 'a'.repeat(501),
        },
        {
          language: 'hi',
          headword: 'बोलना',
          pos: 'verb',
          body: 'ok',
          targetLanguage: 'english',
        },
        { language: 'hi', headword: 'unknown', pos: 'verb', body: 'mystery' },
        { language: 'hi', headword: 'बोलना', pos: 'verb', body: 'to speak' },
      ],
      'mixed CSV',
    );

    expect(result.inserted).toBe(1);
    expect(result.skipped).toHaveLength(7);
    const reasons = result.skipped.map((s) => `row ${s.row}: ${s.reason}`);
    expect(reasons[0]).toMatch(/unsupported language/);
    expect(reasons[1]).toMatch(/empty headword/);
    expect(reasons[2]).toMatch(/empty pos/);
    expect(reasons[3]).toMatch(/empty body/);
    expect(reasons[4]).toMatch(/exceeds 500/);
    expect(reasons[5]).toMatch(/invalid targetLanguage/);
    expect(reasons[6]).toMatch(/lemma not found/);
    // Only one translation insert + one audit insert (row 8).
    const trInserts = calls.filter(
      (c) => c.kind === 'insert' && (c.values as { source?: unknown }).source === 'curator',
    );
    expect(trInserts).toHaveLength(1);
  });

  it('trims and NFC-normalises the headword before the lemma lookup', async () => {
    stage([lemmaRow({ headword: 'बोलना' })]);
    stage([translationRow({ id: 'tr-x' })]);
    stage([{ id: 'hist-1' }]);

    // Padded with whitespace and given as a non-NFC string; normalize +
    // trim should still find the canonical lemma.
    const headword = '  बोलना  '.normalize('NFD');

    const result = await bulkImportTranslations(
      ADMIN,
      [
        {
          language: 'hi',
          headword,
          pos: 'verb',
          body: 'to speak',
        },
      ],
      'NFC test',
    );
    expect(result.inserted).toBe(1);
  });
});

// -----------------------------------------------------------------------
// bulkPromoteTranslations
// -----------------------------------------------------------------------

describe('bulkPromoteTranslations', () => {
  it('rejects non-admins', async () => {
    await expect(
      bulkPromoteTranslations(CURATOR, ['tr-1'], 'promote'),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(calls).toHaveLength(0);
  });

  it('rejects an empty list', async () => {
    await expect(
      bulkPromoteTranslations(ADMIN, [], 'nothing'),
    ).rejects.toBeInstanceOf(CuratorValidationError);
  });

  it('rejects a missing reason', async () => {
    await expect(
      bulkPromoteTranslations(ADMIN, ['tr-1'], '  '),
    ).rejects.toBeInstanceOf(CuratorValidationError);
  });

  it('rejects more than BULK_LIMIT ids', async () => {
    const ids = Array.from({ length: BULK_LIMIT + 1 }, (_, i) => `tr-${i}`);
    await expect(
      bulkPromoteTranslations(ADMIN, ids, 'too many'),
    ).rejects.toBeInstanceOf(CuratorValidationError);
  });

  it('promotes a community row, skips already-curator + imported + missing', async () => {
    stage([
      translationRow({ id: 'tr-1', source: 'user' }),
      translationRow({ id: 'tr-2', source: 'curator' }),
      translationRow({ id: 'tr-3', source: 'official_dictionary' }),
      // tr-4 missing → not in result set
    ]);
    // tr-1 update + audit
    stage([translationRow({ id: 'tr-1', source: 'curator' })]);
    stage([{ id: 'hist-1' }]);

    const result = await bulkPromoteTranslations(
      ADMIN,
      ['tr-1', 'tr-2', 'tr-3', 'tr-4', 'tr-1'], // tr-1 duplicated → dedup
      'Endorsing strong community submissions',
    );
    expect(result.promoted).toBe(1);
    expect(result.skipped).toHaveLength(3);
    const reasonsById = Object.fromEntries(result.skipped.map((s) => [s.id, s.reason]));
    expect(reasonsById['tr-2']).toMatch(/already curator/);
    expect(reasonsById['tr-3']).toMatch(/imported officials/);
    expect(reasonsById['tr-4']).toMatch(/not found/);

    const updCall = calls.find(
      (c): c is Extract<Call, { kind: 'update' }> => c.kind === 'update',
    );
    expect(updCall?.set).toMatchObject({ source: 'curator' });
    const auditInsert = calls.find(
      (c): c is Extract<Call, { kind: 'insert' }> =>
        c.kind === 'insert' &&
        (c.values as { changeType?: string } | undefined)?.changeType ===
          'translation_update',
    );
    expect(auditInsert).toBeDefined();
    expect(
      (auditInsert!.values as { change: Record<string, unknown> }).change,
    ).toMatchObject({
      translationId: 'tr-1',
      bulkPromote: true,
      before: { source: 'user' },
      after: { source: 'curator' },
    });
  });
});

// -----------------------------------------------------------------------
// bulkUpdateAttribution
// -----------------------------------------------------------------------

describe('bulkUpdateAttribution', () => {
  it('rejects non-admins', async () => {
    await expect(
      bulkUpdateAttribution(
        CURATOR,
        {
          source: 'official_dictionary',
          oldAttribution: 'Old',
          newAttribution: 'New',
        },
        'rebrand',
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(calls).toHaveLength(0);
  });

  it('rejects a missing reason', async () => {
    await expect(
      bulkUpdateAttribution(
        ADMIN,
        {
          source: 'official_dictionary',
          oldAttribution: 'Old',
          newAttribution: 'New',
        },
        '',
      ),
    ).rejects.toBeInstanceOf(CuratorValidationError);
  });

  it('refuses to sweep without an oldAttribution', async () => {
    await expect(
      bulkUpdateAttribution(
        ADMIN,
        {
          source: 'official_dictionary',
          oldAttribution: '   ',
          newAttribution: 'New',
        },
        'guard',
      ),
    ).rejects.toBeInstanceOf(CuratorValidationError);
  });

  it('returns 0 updates when no rows match (no scope)', async () => {
    stage([]); // before snapshot → nothing
    const result = await bulkUpdateAttribution(
      ADMIN,
      {
        source: 'official_dictionary',
        oldAttribution: 'Old',
        newAttribution: 'New',
      },
      'rebrand to New',
    );
    expect(result.updated).toBe(0);
    // No update statement, no audit inserts.
    expect(calls.find((c) => c.kind === 'update')).toBeUndefined();
    expect(calls.find((c) => c.kind === 'insert')).toBeUndefined();
  });

  it('returns 0 updates when language scope finds no lemmas', async () => {
    stage([]); // language-scoped lemma id query → []
    const result = await bulkUpdateAttribution(
      ADMIN,
      {
        source: 'official_dictionary',
        oldAttribution: 'Old',
        newAttribution: 'New',
        language: 'or',
      },
      'rebrand Odia',
    );
    expect(result.updated).toBe(0);
  });

  it('rewrites attribution and writes one audit per affected row', async () => {
    const rows = [
      translationRow({
        id: 'tr-1',
        source: 'official_dictionary',
        sourceAttribution: 'Old',
      }),
      translationRow({
        id: 'tr-2',
        lemmaId: 'lemma-2',
        source: 'official_dictionary',
        sourceAttribution: 'Old',
      }),
    ];
    stage(rows); // before snapshot
    stage([{ id: 'hist-1' }]); // tr-1 audit
    stage([{ id: 'hist-2' }]); // tr-2 audit

    const result = await bulkUpdateAttribution(
      ADMIN,
      {
        source: 'official_dictionary',
        oldAttribution: 'Old',
        newAttribution: 'New',
      },
      'Rebrand 2026',
    );
    expect(result.updated).toBe(2);
    const updCall = calls.find(
      (c): c is Extract<Call, { kind: 'update' }> => c.kind === 'update',
    );
    expect(updCall?.set).toMatchObject({ sourceAttribution: 'New' });
    const auditInserts = calls.filter(
      (c): c is Extract<Call, { kind: 'insert' }> =>
        c.kind === 'insert' &&
        (c.values as { changeType?: string } | undefined)?.changeType ===
          'translation_update',
    );
    expect(auditInserts).toHaveLength(2);
    const ids = auditInserts.map(
      (c) =>
        (c.values as { change: { translationId: string } }).change.translationId,
    );
    expect(ids).toEqual(['tr-1', 'tr-2']);
    for (const ai of auditInserts) {
      expect(
        (ai.values as { change: Record<string, unknown> }).change,
      ).toMatchObject({
        bulkAttribution: true,
        before: { sourceAttribution: 'Old' },
        after: { sourceAttribution: 'New' },
      });
    }
  });

  it('rejects an update that would touch more than BULK_LIMIT rows', async () => {
    const tooMany = Array.from({ length: BULK_LIMIT + 1 }, (_, i) =>
      translationRow({
        id: `tr-${i}`,
        source: 'official_dictionary',
        sourceAttribution: 'Old',
      }),
    );
    stage(tooMany); // before snapshot
    await expect(
      bulkUpdateAttribution(
        ADMIN,
        {
          source: 'official_dictionary',
          oldAttribution: 'Old',
          newAttribution: 'New',
        },
        'too broad',
      ),
    ).rejects.toBeInstanceOf(CuratorValidationError);
  });

  it('honors a language scope by pre-filtering through lemmas', async () => {
    // language-scoped lemma id query → 2 lemmas
    stage([{ id: 'lemma-1' }, { id: 'lemma-2' }]);
    // scoped translation id query → 1 hit
    // T-14.7a: scoped row carries the polymorphic target.
    stage([{ id: 'tr-1', targetType: 'lemma', targetId: 'lemma-1' }]);
    // before snapshot of those rows
    stage([
      translationRow({
        id: 'tr-1',
        source: 'official_dictionary',
        sourceAttribution: 'Old',
      }),
    ]);
    // audit insert for tr-1
    stage([{ id: 'hist-1' }]);

    const result = await bulkUpdateAttribution(
      ADMIN,
      {
        source: 'official_dictionary',
        oldAttribution: 'Old',
        newAttribution: 'New',
        language: 'hi',
      },
      'Rebrand Hindi rows',
    );
    expect(result.updated).toBe(1);
    // Three SELECTs: lemma id list, scoped id list, before snapshot.
    expect(calls.filter((c) => c.kind === 'select')).toHaveLength(3);
  });
});
