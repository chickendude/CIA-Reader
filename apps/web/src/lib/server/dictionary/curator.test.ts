// @vitest-environment node
/**
 * Unit tests for the curator dictionary editor service (T-3.7).
 *
 * The service issues a consistent pattern of DB calls per mutator:
 *   1. SELECT the target lemma (loadLemma) — always first.
 *   2. Permission check (may hit DB for non-admin curators via
 *      requireCanEditDictionary; admins short-circuit).
 *   3. The actual UPDATE/INSERT/DELETE.
 *   4. INSERT into lemma_edit_history via recordLemmaEdit.
 *
 * We stage each SELECT's rows in order and assert the written payloads
 * via a `calls` log. Admin editors skip the permission-check SELECT.
 */
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
  chain.returning = vi.fn(() => nextStaged());
  // Support updates without .returning() (rewires in merge/split).
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
    lemmas: { id: 'lemmas.id', language: 'lemmas.language' },
    translations: {
      id: 'translations.id',
      targetType: 'translations.target_type',
      targetId: 'translations.target_id',
    },
    lemmaForms: {
      id: 'lemma_forms.id',
      lemmaId: 'lemma_forms.lemma_id',
    },
    lemmaEditHistory: {
      id: 'lemma_edit_history.id',
      lemmaId: 'lemma_edit_history.lemma_id',
      editorId: 'lemma_edit_history.editor_id',
      changeType: 'lemma_edit_history.change_type',
      reason: 'lemma_edit_history.reason',
      createdAt: 'lemma_edit_history.created_at',
    },
    curatorLanguages: {
      userId: 'curator_languages.user_id',
      language: 'curator_languages.language',
    },
  },
}));

const {
  CuratorValidationError,
  getLemmaEditorView,
  mergeLemmas,
  reorderTranslations,
  setLemmaLock,
  setTranslationHidden,
  splitLemma,
  updateLemma,
  updateTranslation,
} = await import('./curator.js');

const { ForbiddenError } = await import('./permissions.js');

const ADMIN = { id: 'admin-1', role: 'admin' as const };

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
    sourceId: 'hwn:12345',
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
    // pair. Phrase-target curator flows go through the phrase
    // editor (T-14.4a).
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
    displayRank: null,
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
// updateLemma
// -----------------------------------------------------------------------

describe('updateLemma', () => {
  it('accepts an empty reason and writes the audit row with the placeholder', async () => {
    stage([lemmaRow()]); // loadLemma
    stage([{ ...lemmaRow(), glossDefault: 'updated' }]); // update .returning
    stage([{ id: 'edit-1' }]); // audit insert .returning
    const out = await updateLemma(
      ADMIN,
      'lemma-1',
      { glossDefault: 'updated' },
      '  ',
    );
    expect(out).toBeDefined();
    // The audit insert is the last `insert`-kind call. Its `values`
    // payload carries the persisted reason — empty/whitespace-only
    // input falls through to the placeholder.
    const auditInsert = [...calls]
      .reverse()
      .find((c): c is Extract<Call, { kind: 'insert' }> => c.kind === 'insert');
    expect((auditInsert?.values as { reason?: string } | undefined)?.reason).toBe(
      '(no reason given)',
    );
  });

  it('returns 404 when the lemma does not exist', async () => {
    stage([]); // loadLemma -> empty
    await expect(
      updateLemma(ADMIN, 'missing', { glossDefault: 'x' }, 'typo fix'),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects a non-curator non-admin', async () => {
    stage([lemmaRow()]); // loadLemma
    stage([]); // permission check: no curator_languages row
    await expect(
      updateLemma(
        { id: 'plain', role: 'user' },
        'lemma-1',
        { glossDefault: 'x' },
        'typo fix',
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('normalizes headword, locks the row, and records a diff', async () => {
    stage([lemmaRow()]); // loadLemma
    const updated = {
      ...lemmaRow(),
      headword: 'बोलना',
      glossDefault: 'to say',
      curatorLocked: true,
    };
    stage([updated]); // .returning from update
    stage([{ id: 'hist-1' }]); // insert history .returning

    const row = await updateLemma(
      ADMIN,
      'lemma-1',
      { headword: '  बोलना  ', glossDefault: 'to say' },
      'Reword the gloss to match the canonical register',
    );
    expect(row.glossDefault).toBe('to say');

    const updCall = calls.find(
      (c): c is Extract<Call, { kind: 'update' }> => c.kind === 'update',
    );
    expect(updCall?.set).toMatchObject({
      headword: 'बोलना',
      glossDefault: 'to say',
      curatorLocked: true,
    });
    const histInsert = calls.find(
      (c): c is Extract<Call, { kind: 'insert' }> =>
        c.kind === 'insert' &&
        (c.values as { changeType?: string } | undefined)?.changeType ===
          'lemma_update',
    );
    expect(histInsert).toBeDefined();
  });

  it('rejects a negative frequencyRank', async () => {
    await expect(
      updateLemma(ADMIN, 'lemma-1', { frequencyRank: -1 }, 'typo fix'),
    ).rejects.toBeInstanceOf(CuratorValidationError);
  });

  it('rejects a malformed ISO 15924 script', async () => {
    await expect(
      updateLemma(ADMIN, 'lemma-1', { script: 'deva' }, 'typo fix'),
    ).rejects.toBeInstanceOf(CuratorValidationError);
  });
});

// -----------------------------------------------------------------------
// setLemmaLock
// -----------------------------------------------------------------------

describe('setLemmaLock', () => {
  it('is a no-op when the flag already matches', async () => {
    stage([lemmaRow({ curatorLocked: true })]); // loadLemma
    const row = await setLemmaLock(ADMIN, 'lemma-1', true, 'reason noop');
    expect(row.curatorLocked).toBe(true);
    expect(calls.find((c) => c.kind === 'update')).toBeUndefined();
  });

  it('writes lemma_unlock audit when unlocking', async () => {
    stage([lemmaRow({ curatorLocked: true })]);
    stage([lemmaRow({ curatorLocked: false })]);
    stage([{ id: 'hist-1' }]);
    await setLemmaLock(ADMIN, 'lemma-1', false, 'Re-open for fresh import');
    const histInsert = calls.find(
      (c): c is Extract<Call, { kind: 'insert' }> =>
        c.kind === 'insert' &&
        (c.values as { changeType?: string } | undefined)?.changeType ===
          'lemma_unlock',
    );
    expect(histInsert).toBeDefined();
  });
});

// -----------------------------------------------------------------------
// updateTranslation
// -----------------------------------------------------------------------

describe('updateTranslation', () => {
  it('promotes a user translation to curator and audits it', async () => {
    stage([translationRow()]); // loadTranslation
    stage([lemmaRow()]); // loadLemma via parent
    const updated = { ...translationRow(), source: 'curator', body: 'to speak' };
    stage([updated]); // update returning
    stage([{ id: 'hist-1' }]);

    const row = await updateTranslation(
      ADMIN,
      'tr-1',
      { promoteToCurator: true },
      'Endorsing a strong community gloss',
    );
    expect(row.source).toBe('curator');
    const updCall = calls.find(
      (c): c is Extract<Call, { kind: 'update' }> => c.kind === 'update',
    );
    expect(updCall?.set).toMatchObject({ source: 'curator' });
  });

  it('refuses to re-tag an imported official translation as curator', async () => {
    stage([translationRow({ source: 'official_dictionary' })]);
    stage([lemmaRow()]);
    await expect(
      updateTranslation(
        ADMIN,
        'tr-1',
        { promoteToCurator: true },
        'trying to re-tag',
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('validates the body length', async () => {
    await expect(
      updateTranslation(
        ADMIN,
        'tr-1',
        { body: 'x'.repeat(600) },
        'too long',
      ),
    ).rejects.toBeInstanceOf(CuratorValidationError);
  });
});

// -----------------------------------------------------------------------
// setTranslationHidden
// -----------------------------------------------------------------------

describe('setTranslationHidden', () => {
  it('refuses to hide a non-community translation', async () => {
    stage([translationRow({ source: 'curator' })]);
    stage([lemmaRow()]);
    await expect(
      setTranslationHidden(ADMIN, 'tr-1', true, 'abuse'),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('hides a community translation and audits it', async () => {
    stage([translationRow()]);
    stage([lemmaRow()]);
    stage([translationRow({ hidden: true })]);
    stage([{ id: 'hist-1' }]);

    await setTranslationHidden(ADMIN, 'tr-1', true, 'Spam submission');
    const histInsert = calls.find(
      (c): c is Extract<Call, { kind: 'insert' }> =>
        c.kind === 'insert' &&
        (c.values as { changeType?: string } | undefined)?.changeType ===
          'translation_hide',
    );
    expect(histInsert).toBeDefined();
  });

  it('is a no-op when the flag already matches', async () => {
    stage([translationRow({ hidden: true })]);
    stage([lemmaRow()]);
    const row = await setTranslationHidden(
      ADMIN,
      'tr-1',
      true,
      'already hidden',
    );
    expect(row.hidden).toBe(true);
    expect(calls.find((c) => c.kind === 'update')).toBeUndefined();
  });
});

// -----------------------------------------------------------------------
// mergeLemmas
// -----------------------------------------------------------------------

describe('mergeLemmas', () => {
  it('rejects merging a lemma into itself', async () => {
    await expect(
      mergeLemmas(
        ADMIN,
        { winnerId: 'lemma-1', loserId: 'lemma-1' },
        'selfsame',
      ),
    ).rejects.toBeInstanceOf(CuratorValidationError);
  });

  it('rejects a cross-language merge', async () => {
    stage([lemmaRow({ id: 'lemma-1', language: 'hi' })]); // winner load
    stage([lemmaRow({ id: 'lemma-2', language: 'mr' })]); // loser load
    await expect(
      mergeLemmas(
        ADMIN,
        { winnerId: 'lemma-1', loserId: 'lemma-2' },
        'cross lang mistake',
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rewires translations + forms, deletes the loser, and audits both sides', async () => {
    stage([lemmaRow({ id: 'lemma-1' })]); // winner
    stage([lemmaRow({ id: 'lemma-2', headword: 'बोल' })]); // loser
    // T-14.7a: loser translations carry the polymorphic target.
    stage([
      translationRow({ id: 'tr-1', targetType: 'lemma', targetId: 'lemma-2' }),
    ]); // loser translations
    stage([{ id: 'form-1', lemmaId: 'lemma-2', surface: 'bola' }]); // loser forms
    stage([{ id: 'hist-loser' }]); // audit loser insert
    stage([{ id: 'hist-winner' }]); // audit winner insert

    const result = await mergeLemmas(
      ADMIN,
      { winnerId: 'lemma-1', loserId: 'lemma-2' },
      'Duplicate import — canonical entry is lemma-1',
    );

    expect(result.translationsMoved).toBe(1);
    expect(result.formsMoved).toBe(1);
    // Exactly one delete call (the loser).
    expect(calls.filter((c) => c.kind === 'delete')).toHaveLength(1);
    // Two merge audit inserts (one per direction).
    const mergeAudits = calls.filter(
      (c): c is Extract<Call, { kind: 'insert' }> =>
        c.kind === 'insert' &&
        (c.values as { changeType?: string } | undefined)?.changeType ===
          'lemma_merge',
    );
    expect(mergeAudits).toHaveLength(2);
    const directions = mergeAudits.map(
      (c) =>
        (c.values as { change?: { direction?: string } } | undefined)?.change
          ?.direction,
    );
    expect(directions).toContain('loser');
    expect(directions).toContain('winner');
  });
});

// -----------------------------------------------------------------------
// splitLemma
// -----------------------------------------------------------------------

describe('splitLemma', () => {
  it('requires at least one translation or form to move', async () => {
    stage([lemmaRow()]); // loadLemma
    await expect(
      splitLemma(
        ADMIN,
        {
          fromLemmaId: 'lemma-1',
          newLemma: { headword: 'सोना', pos: 'noun' },
        },
        'split gold from sleep',
      ),
    ).rejects.toBeInstanceOf(CuratorValidationError);
  });

  it('rejects translation ids that do not belong to the source lemma', async () => {
    stage([lemmaRow({ id: 'lemma-1' })]); // loadLemma
    // T-14.7a: belongs-elsewhere check reads via the polymorphic
    // target.
    stage([
      { id: 'tr-1', targetType: 'lemma', targetId: 'lemma-999' },
    ]); // translation belongs elsewhere
    await expect(
      splitLemma(
        ADMIN,
        {
          fromLemmaId: 'lemma-1',
          newLemma: { headword: 'सोना', pos: 'noun' },
          translationIds: ['tr-1'],
        },
        'split gold from sleep',
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('creates a new curator lemma and moves selected children, auditing both sides', async () => {
    stage([lemmaRow({ id: 'lemma-1', headword: 'सोना' })]); // source
    // T-14.7a: translation validation now reads via the
    // polymorphic columns; staged row mirrors that.
    stage([{ id: 'tr-1', targetType: 'lemma', targetId: 'lemma-1' }]);
    stage([{ id: 'form-1', lemmaId: 'lemma-1' }]); // form validation (lemma_forms.lemma_id is unaffected)
    const created = lemmaRow({
      id: 'lemma-new',
      headword: 'सोना',
      pos: 'noun',
      source: 'curator',
      sourceAttribution: 'Split from सोना',
      curatorLocked: true,
    });
    stage([created]); // insert new lemma returning
    stage([{ id: 'hist-src' }]); // source audit
    stage([{ id: 'hist-new' }]); // created audit

    const result = await splitLemma(
      ADMIN,
      {
        fromLemmaId: 'lemma-1',
        newLemma: { headword: 'सोना', pos: 'noun' },
        translationIds: ['tr-1'],
        formIds: ['form-1'],
      },
      'Disambiguate gold (noun) from sleep (verb)',
    );

    expect(result.created.id).toBe('lemma-new');
    expect(result.translationsMoved).toBe(1);
    expect(result.formsMoved).toBe(1);

    const insertCalls = calls.filter(
      (c): c is Extract<Call, { kind: 'insert' }> => c.kind === 'insert',
    );
    // 1 new lemma + 2 history rows
    expect(insertCalls).toHaveLength(3);
    const splitAudits = insertCalls.filter(
      (c) =>
        (c.values as { changeType?: string } | undefined)?.changeType ===
        'lemma_split',
    );
    expect(splitAudits).toHaveLength(2);
    const directions = splitAudits.map(
      (c) =>
        (c.values as { change?: { direction?: string } } | undefined)?.change
          ?.direction,
    );
    expect(directions).toContain('source');
    expect(directions).toContain('created');
  });
});

// -----------------------------------------------------------------------
// getLemmaEditorView
// -----------------------------------------------------------------------

describe('getLemmaEditorView', () => {
  it('assembles lemma + translations + forms + history for the editor', async () => {
    stage([lemmaRow()]); // loadLemma
    stage([translationRow(), translationRow({ id: 'tr-2' })]); // translations
    stage([{ id: 'form-1', lemmaId: 'lemma-1', surface: 'bolta', features: {} }]);
    stage([
      {
        id: 'hist-1',
        changeType: 'lemma_update',
        reason: 'typo',
        createdAt: new Date(),
        editorId: 'admin-1',
      },
    ]);
    const view = await getLemmaEditorView(ADMIN, 'lemma-1');
    expect(view.lemma.id).toBe('lemma-1');
    expect(view.translations).toHaveLength(2);
    expect(view.forms).toHaveLength(1);
    expect(view.history).toHaveLength(1);
  });

  it('rejects a curator without the language grant', async () => {
    stage([lemmaRow({ language: 'or' })]); // loadLemma
    stage([]); // permission check: no grant
    await expect(
      getLemmaEditorView({ id: 'c1', role: 'curator' }, 'lemma-1'),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// -----------------------------------------------------------------------
// reorderTranslations (T-3.13)
// -----------------------------------------------------------------------

describe('reorderTranslations', () => {
  it('rejects an empty order list', async () => {
    await expect(
      reorderTranslations(ADMIN, 'lemma-1', [], 'pinning curated meanings up top'),
    ).rejects.toBeInstanceOf(CuratorValidationError);
  });

  it('rejects a duplicate id in the order', async () => {
    await expect(
      reorderTranslations(
        ADMIN,
        'lemma-1',
        ['tr-1', 'tr-1'],
        'pinning curated meanings up top',
      ),
    ).rejects.toBeInstanceOf(CuratorValidationError);
  });

  it('rejects a non-curator non-admin', async () => {
    stage([lemmaRow()]); // loadLemma
    stage([]); // permission check: no curator_languages row
    await expect(
      reorderTranslations(
        { id: 'plain', role: 'user' },
        'lemma-1',
        ['tr-1', 'tr-2'],
        'pinning curated meanings up top',
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects when the order count does not match the lemma translations', async () => {
    stage([lemmaRow()]); // loadLemma
    stage([translationRow({ id: 'tr-1' }), translationRow({ id: 'tr-2' })]); // existing
    await expect(
      reorderTranslations(
        ADMIN,
        'lemma-1',
        ['tr-1'], // missing tr-2
        'partial reorder',
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rejects an order containing an unknown translation id', async () => {
    stage([lemmaRow()]); // loadLemma
    stage([translationRow({ id: 'tr-1' }), translationRow({ id: 'tr-2' })]); // existing
    await expect(
      reorderTranslations(
        ADMIN,
        'lemma-1',
        ['tr-1', 'tr-99'],
        'order references unknown id',
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('writes display_rank by index, audits with translation_reorder, and returns the new order', async () => {
    stage([lemmaRow()]); // loadLemma
    stage([
      translationRow({ id: 'tr-2', body: 'second' }),
      translationRow({ id: 'tr-1', body: 'first' }),
    ]); // existing — reverse of desired order
    stage([{ id: 'hist-1' }]); // audit insert

    const result = await reorderTranslations(
      ADMIN,
      'lemma-1',
      ['tr-1', 'tr-2'],
      'Pinning the more idiomatic gloss first',
    );

    // Two updates, one per translation, each carrying the right rank.
    const updateCalls = calls.filter(
      (c): c is Extract<Call, { kind: 'update' }> => c.kind === 'update',
    );
    expect(updateCalls).toHaveLength(2);
    expect((updateCalls[0]!.set as { displayRank?: number }).displayRank).toBe(0);
    expect((updateCalls[1]!.set as { displayRank?: number }).displayRank).toBe(1);

    // Returned rows in the new order with the assigned ranks.
    expect(result.map((t) => t.id)).toEqual(['tr-1', 'tr-2']);
    expect(result.map((t) => t.displayRank)).toEqual([0, 1]);

    // Single audit insert with the reorder discriminator + before/after.
    const audit = calls.find(
      (c): c is Extract<Call, { kind: 'insert' }> =>
        c.kind === 'insert' &&
        (c.values as { changeType?: string } | undefined)?.changeType ===
          'translation_reorder',
    );
    expect(audit).toBeDefined();
    const change = (audit?.values as { change?: { translationOrderBefore?: unknown[]; translationOrderAfter?: unknown[] } } | undefined)?.change;
    expect(change?.translationOrderBefore).toHaveLength(2);
    expect(change?.translationOrderAfter).toEqual([
      { translationId: 'tr-1', displayRank: 0 },
      { translationId: 'tr-2', displayRank: 1 },
    ]);
  });
});
