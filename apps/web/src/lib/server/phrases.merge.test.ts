// @vitest-environment node
/**
 * Tests for `mergePhrases`, `setPhraseHidden`, `setPhraseLocked`
 * (T-14.7 curator-merge + moderation parity).
 *
 * Mocks Drizzle via the same staged-result pattern as the rest of
 * the phrase tests (`phrases.test.ts`). Each test stages the
 * sequence of SELECTs / UPDATEs / DELETEs the service runs and
 * asserts that the recorded `calls` log matches.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Call =
  | { kind: 'select' }
  | { kind: 'insert'; payload?: unknown }
  | { kind: 'update'; set?: unknown; whereTag?: string }
  | { kind: 'delete'; whereTag?: string };

const calls: Call[] = [];
const staged: unknown[][] = [];

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
  chain.innerJoin = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.offset = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) => resolve(nextStaged());
  return chain as unknown;
}
function makeInsertChain() {
  const chain = {
    values: vi.fn((payload: unknown) => {
      calls.push({ kind: 'insert', payload });
      return chain;
    }),
    returning: vi.fn(() => nextStaged()),
  };
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
  // For UPDATEs that aren't returning() (e.g. plain reassignment
  // queries inside mergePhrases) the chain awaits to undefined.
  chain.then = (resolve: (v: unknown) => unknown) => resolve(undefined);
  return chain;
}
function makeDeleteChain() {
  const entry: Call = { kind: 'delete' };
  calls.push(entry);
  const chain: Record<string, unknown> = {};
  chain.where = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) => resolve(undefined);
  return chain;
}

const selectFn = vi.fn(() => {
  calls.push({ kind: 'select' });
  return makeSelectChain();
});
const insertFn = vi.fn(() => makeInsertChain());
const updateFn = vi.fn(() => makeUpdateChain());
const deleteFn = vi.fn(() => makeDeleteChain());

vi.mock('./db/index.js', () => ({
  db: {
    select: () => selectFn(),
    insert: () => insertFn(),
    update: () => updateFn(),
    delete: () => deleteFn(),
  },
  schema: {
    phrases: {
      id: 'phrases.id',
      language: 'phrases.language',
      surfaceNormalised: 'phrases.surface_normalised',
      curatorLocked: 'phrases.curator_locked',
      hidden: 'phrases.hidden',
    },
    phraseTokens: {
      phraseId: 'phrase_tokens.phrase_id',
    },
    phraseChapterSpans: {
      chapterId: 'phrase_chapter_spans.chapter_id',
      phraseId: 'phrase_chapter_spans.phrase_id',
      startTokenIdx: 'phrase_chapter_spans.start_token_idx',
      endTokenIdx: 'phrase_chapter_spans.end_token_idx',
    },
    userKnownPhrases: {
      userId: 'user_known_phrases.user_id',
      phraseId: 'user_known_phrases.phrase_id',
      status: 'user_known_phrases.status',
    },
    translations: {
      id: 'translations.id',
      targetType: 'translations.target_type',
      targetId: 'translations.target_id',
    },
    lemmaEditHistory: {
      id: 'lemma_edit_history.id',
      lemmaId: 'lemma_edit_history.lemma_id',
      phraseId: 'lemma_edit_history.phrase_id',
      changeType: 'lemma_edit_history.change_type',
    },
    userLanguages: {
      userId: 'user_languages.user_id',
      language: 'user_languages.language',
    },
    lemmas: { id: 'lemmas.id' },
    userKnownLemmas: {
      userId: 'user_known_lemmas.user_id',
      lemmaId: 'user_known_lemmas.lemma_id',
      status: 'user_known_lemmas.status',
    },
    lemmaEditChangeType: {
      enumValues: [
        'lemma_update',
        'lemma_unlock',
        'lemma_lock',
        'translation_insert',
        'translation_update',
        'translation_hide',
        'translation_unhide',
        'form_insert',
        'form_delete',
        'lemma_merge',
        'lemma_split',
        'translation_reorder',
        'phrase_update',
        'phrase_lock',
        'phrase_unlock',
        'phrase_hide',
        'phrase_unhide',
        'phrase_merge',
      ],
    },
  },
}));

const {
  mergePhrases,
  setPhraseHidden,
  setPhraseLocked,
  PhraseMergeMismatchError,
  PhraseValidationError,
} = await import('./phrases.js');

beforeEach(() => {
  calls.length = 0;
  staged.length = 0;
  selectFn.mockClear();
  insertFn.mockClear();
  updateFn.mockClear();
  deleteFn.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------
// mergePhrases
// ---------------------------------------------------------------

describe('mergePhrases — happy path', () => {
  it('reassigns translations + spans + status rows from drop to keep', async () => {
    // 1: keep lookup
    stage([
      {
        id: 'phr-keep',
        language: 'hi',
        surfaceNormalised: 'इंतज़ार करना',
        source: 'curator',
        curatorLocked: false,
        hidden: false,
      },
    ]);
    // 2: drop lookup
    stage([
      {
        id: 'phr-drop',
        language: 'hi',
        surfaceNormalised: 'इंतज़ार करना',
        source: 'user',
        sourceAttribution: null,
        curatorLocked: false,
        hidden: false,
      },
    ]);
    // 3: translations on drop side
    stage([{ id: 'tr-1' }, { id: 'tr-2' }]);
    // 4: drop spans
    stage([
      {
        chapterId: 'ch-1',
        startTokenIdx: 0,
        endTokenIdx: 1,
        phraseId: 'phr-drop',
      },
      {
        chapterId: 'ch-2',
        startTokenIdx: 5,
        endTokenIdx: 6,
        phraseId: 'phr-drop',
      },
    ]);
    // 5: keep spans (collision check)
    stage([
      // Keep already has a span at (ch-1, 0) — drop's identical
      // span will be left to cascade-delete.
      { chapterId: 'ch-1', startTokenIdx: 0 },
    ]);
    // 6: drop status rows
    stage([
      {
        userId: 'u-A',
        phraseId: 'phr-drop',
        status: 'known',
        updatedAt: new Date(),
      },
      {
        userId: 'u-B',
        phraseId: 'phr-drop',
        status: 'learning',
        updatedAt: new Date(),
      },
    ]);
    // 7: u-A collision check on keep side — u-A also has a row
    // pointing at keep with status 'learning'; merge picks higher.
    stage([{ userId: 'u-A', status: 'learning' }]);
    // 8: u-B collision check — no row on keep side, so reassign.
    stage([]);
    // 9: kept phrase update returning
    stage([
      {
        id: 'phr-keep',
        language: 'hi',
        surfaceNormalised: 'इंतज़ार करना',
        source: 'curator',
        curatorLocked: false,
        hidden: false,
      },
    ]);
    // 10: audit insert (winner) — returns one row.
    stage([{ id: 'audit-w' }]);
    // 11: audit insert (loser) — returns one row.
    stage([{ id: 'audit-l' }]);

    const result = await mergePhrases({
      keepId: 'phr-keep',
      dropId: 'phr-drop',
      performedBy: 'editor-1',
      reason: 'duplicate user submission',
    });

    expect(result.keptPhrase.id).toBe('phr-keep');
    expect(result.droppedPhrase.id).toBe('phr-drop');
    expect(result.moved.translations).toBe(2);
    // Two drop spans, one collided with keep — only one moves.
    expect(result.moved.spans).toBe(1);
    // Two drop status rows; u-A collided (status updated in place,
    // not "moved"), u-B reassigned.
    expect(result.moved.knownPhraseRows).toBe(1);

    // Inserts: translations.update (one), spans.update (one),
    // user_known_phrases collision update (u-A, status:'known'
    // which is higher than 'learning'), user_known_phrases
    // reassign (u-B), kept-phrase updated_at bump, two audit
    // inserts. The exact insert/update/delete count is verified
    // below.
    const updates = calls.filter((c) => c.kind === 'update');
    // translations reassign + spans reassign + u-A status update +
    // u-B reassign + kept-phrase updated_at bump = 5.
    expect(updates).toHaveLength(5);
    const inserts = calls.filter((c) => c.kind === 'insert');
    // Two audit inserts (winner + loser).
    expect(inserts).toHaveLength(2);
    const deletes = calls.filter((c) => c.kind === 'delete');
    // Single delete on the dropped phrase row; cascading FKs do
    // the rest.
    expect(deletes).toHaveLength(1);
  });

  it('skips translation reassignment when the drop side has no translations', async () => {
    stage([
      {
        id: 'phr-keep',
        language: 'hi',
        surfaceNormalised: 'क',
        source: 'curator',
        curatorLocked: false,
        hidden: false,
      },
    ]);
    stage([
      {
        id: 'phr-drop',
        language: 'hi',
        surfaceNormalised: 'क',
        source: 'user',
        sourceAttribution: null,
        curatorLocked: false,
        hidden: false,
      },
    ]);
    stage([]); // no translations on drop
    stage([]); // no drop spans
    stage([]); // no drop status rows
    stage([
      {
        id: 'phr-keep',
        language: 'hi',
        surfaceNormalised: 'क',
        source: 'curator',
        curatorLocked: false,
        hidden: false,
      },
    ]); // keep update returning
    stage([{ id: 'audit-w' }]);
    stage([{ id: 'audit-l' }]);

    const result = await mergePhrases({
      keepId: 'phr-keep',
      dropId: 'phr-drop',
      performedBy: 'editor-1',
      reason: 'duplicate',
    });
    expect(result.moved).toEqual({
      translations: 0,
      spans: 0,
      knownPhraseRows: 0,
    });
  });
});

describe('mergePhrases — validation', () => {
  it('rejects keepId === dropId', async () => {
    await expect(
      mergePhrases({
        keepId: 'phr-1',
        dropId: 'phr-1',
        performedBy: 'editor-1',
        reason: 'oops',
      }),
    ).rejects.toBeInstanceOf(PhraseMergeMismatchError);
  });

  it('rejects when phrases differ in language', async () => {
    stage([
      {
        id: 'phr-keep',
        language: 'hi',
        surfaceNormalised: 'a',
        curatorLocked: false,
        hidden: false,
      },
    ]);
    stage([
      {
        id: 'phr-drop',
        language: 'mr',
        surfaceNormalised: 'a',
        curatorLocked: false,
        hidden: false,
      },
    ]);
    await expect(
      mergePhrases({
        keepId: 'phr-keep',
        dropId: 'phr-drop',
        performedBy: 'editor-1',
        reason: 'cross-lang',
      }),
    ).rejects.toBeInstanceOf(PhraseMergeMismatchError);
  });

  it('rejects when phrases differ in surface_normalised', async () => {
    stage([
      {
        id: 'phr-keep',
        language: 'hi',
        surfaceNormalised: 'इंतज़ार करना',
        curatorLocked: false,
        hidden: false,
      },
    ]);
    stage([
      {
        id: 'phr-drop',
        language: 'hi',
        surfaceNormalised: 'मदद करना',
        curatorLocked: false,
        hidden: false,
      },
    ]);
    await expect(
      mergePhrases({
        keepId: 'phr-keep',
        dropId: 'phr-drop',
        performedBy: 'editor-1',
        reason: 'wrong surface',
      }),
    ).rejects.toBeInstanceOf(PhraseMergeMismatchError);
  });

  it('throws PhraseValidationError(404) when keep side missing', async () => {
    stage([]);
    try {
      await mergePhrases({
        keepId: 'phr-keep',
        dropId: 'phr-drop',
        performedBy: 'editor-1',
        reason: 'gone',
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PhraseValidationError);
      expect((err as InstanceType<typeof PhraseValidationError>).status).toBe(404);
    }
  });
});

// ---------------------------------------------------------------
// setPhraseHidden
// ---------------------------------------------------------------

describe('setPhraseHidden', () => {
  it('flips the flag, returns the updated row, writes audit', async () => {
    stage([
      {
        id: 'phr-1',
        language: 'hi',
        hidden: false,
        curatorLocked: false,
        surfaceNormalised: 'x',
      },
    ]);
    stage([
      {
        id: 'phr-1',
        language: 'hi',
        hidden: true,
        curatorLocked: false,
        surfaceNormalised: 'x',
      },
    ]);
    stage([{ id: 'audit-1' }]);

    const updated = await setPhraseHidden({
      phraseId: 'phr-1',
      hidden: true,
      editorId: 'editor-1',
      reason: 'spam translation',
    });
    expect(updated.hidden).toBe(true);
    const inserts = calls.filter((c) => c.kind === 'insert');
    expect(inserts).toHaveLength(1);
    expect((inserts[0] as { payload: { changeType: string } }).payload.changeType).toBe(
      'phrase_hide',
    );
  });

  it('is a no-op when the flag is already in the requested state', async () => {
    stage([
      {
        id: 'phr-1',
        language: 'hi',
        hidden: true,
        curatorLocked: false,
        surfaceNormalised: 'x',
      },
    ]);
    const updated = await setPhraseHidden({
      phraseId: 'phr-1',
      hidden: true,
      editorId: 'editor-1',
      reason: 'already hidden',
    });
    expect(updated.hidden).toBe(true);
    expect(calls.filter((c) => c.kind === 'update')).toHaveLength(0);
    expect(calls.filter((c) => c.kind === 'insert')).toHaveLength(0);
  });

  it('throws 404 when the phrase does not exist', async () => {
    stage([]);
    try {
      await setPhraseHidden({
        phraseId: 'phr-missing',
        hidden: true,
        editorId: 'editor-1',
        reason: 'absent',
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PhraseValidationError);
      expect((err as InstanceType<typeof PhraseValidationError>).status).toBe(404);
    }
  });
});

// ---------------------------------------------------------------
// setPhraseLocked
// ---------------------------------------------------------------

describe('setPhraseLocked', () => {
  it('flips the flag and writes audit with phrase_lock change type', async () => {
    stage([
      {
        id: 'phr-1',
        language: 'hi',
        hidden: false,
        curatorLocked: false,
        surfaceNormalised: 'x',
      },
    ]);
    stage([
      {
        id: 'phr-1',
        language: 'hi',
        hidden: false,
        curatorLocked: true,
        surfaceNormalised: 'x',
      },
    ]);
    stage([{ id: 'audit-1' }]);
    const updated = await setPhraseLocked({
      phraseId: 'phr-1',
      locked: true,
      editorId: 'editor-1',
      reason: 'curated',
    });
    expect(updated.curatorLocked).toBe(true);
    const inserts = calls.filter((c) => c.kind === 'insert');
    expect((inserts[0] as { payload: { changeType: string } }).payload.changeType).toBe(
      'phrase_lock',
    );
  });

  it('uses phrase_unlock when releasing the lock', async () => {
    stage([
      {
        id: 'phr-1',
        language: 'hi',
        hidden: false,
        curatorLocked: true,
        surfaceNormalised: 'x',
      },
    ]);
    stage([
      {
        id: 'phr-1',
        language: 'hi',
        hidden: false,
        curatorLocked: false,
        surfaceNormalised: 'x',
      },
    ]);
    stage([{ id: 'audit-1' }]);
    await setPhraseLocked({
      phraseId: 'phr-1',
      locked: false,
      editorId: 'editor-1',
      reason: 'release',
    });
    const inserts = calls.filter((c) => c.kind === 'insert');
    expect((inserts[0] as { payload: { changeType: string } }).payload.changeType).toBe(
      'phrase_unlock',
    );
  });
});
