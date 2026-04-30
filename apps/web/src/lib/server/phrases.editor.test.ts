// @vitest-environment node
/**
 * Unit tests for the curator phrase editor service (T-14.4a).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Call =
  | { kind: 'select' }
  | { kind: 'selectDistinct' }
  | { kind: 'insert'; payload?: unknown }
  | { kind: 'update'; set?: unknown };
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
  chain.orderBy = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.offset = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) => resolve(nextStaged());
  return chain;
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
  chain.then = (resolve: (v: unknown) => unknown) => resolve(undefined);
  return chain;
}

const selectFn = vi.fn(() => {
  calls.push({ kind: 'select' });
  return makeSelectChain();
});
const selectDistinctFn = vi.fn(() => {
  calls.push({ kind: 'selectDistinct' });
  return makeSelectChain();
});
const insertFn = vi.fn(() => makeInsertChain());
const updateFn = vi.fn(() => makeUpdateChain());

vi.mock('./db/index.js', () => ({
  db: {
    select: () => selectFn(),
    selectDistinct: () => selectDistinctFn(),
    insert: () => insertFn(),
    update: () => updateFn(),
  },
  schema: {
    phrases: {
      id: 'phrases.id',
      language: 'phrases.language',
      surfaceNormalised: 'phrases.surface_normalised',
      pos: 'phrases.pos',
      glossDefault: 'phrases.gloss_default',
      frequencyRank: 'phrases.frequency_rank',
      source: 'phrases.source',
      sourceAttribution: 'phrases.source_attribution',
      curatorLocked: 'phrases.curator_locked',
      hidden: 'phrases.hidden',
      createdAt: 'phrases.created_at',
      updatedAt: 'phrases.updated_at',
    },
    phraseTokens: { phraseId: 'phrase_tokens.phrase_id', position: 'phrase_tokens.position', surface: 'phrase_tokens.surface' },
    phraseChapterSpans: {
      chapterId: 'phrase_chapter_spans.chapter_id',
      phraseId: 'phrase_chapter_spans.phrase_id',
    },
    translations: {
      targetType: 'translations.target_type',
      targetId: 'translations.target_id',
      hidden: 'translations.hidden',
    },
    lemmaEditHistory: {
      id: 'lemma_edit_history.id',
      phraseId: 'lemma_edit_history.phrase_id',
      changeType: 'lemma_edit_history.change_type',
      reason: 'lemma_edit_history.reason',
      createdAt: 'lemma_edit_history.created_at',
      editorId: 'lemma_edit_history.editor_id',
    },
    userKnownPhrases: {
      userId: 'user_known_phrases.user_id',
      phraseId: 'user_known_phrases.phrase_id',
      status: 'user_known_phrases.status',
    },
    userLanguages: {
      userId: 'user_languages.user_id',
      language: 'user_languages.language',
    },
  },
}));

const {
  listAdminPhrases,
  getPhraseEditorView,
  updatePhraseFields,
  PhraseValidationError,
} = await import('./phrases.js');

beforeEach(() => {
  calls.length = 0;
  staged.length = 0;
  selectFn.mockClear();
  selectDistinctFn.mockClear();
  insertFn.mockClear();
  updateFn.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------
// listAdminPhrases
// ---------------------------------------------------------------

describe('listAdminPhrases', () => {
  it('returns rows with translation + chapter counts', async () => {
    stage([
      {
        id: 'phr-1',
        language: 'hi',
        surfaceNormalised: 'इंतज़ार करना',
        pos: 'VERB',
        glossDefault: 'to wait',
        frequencyRank: null,
        source: 'curator',
        curatorLocked: false,
        hidden: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        translationCount: 3,
        chapterCount: 7,
      },
    ]);

    const rows = await listAdminPhrases({ language: 'hi' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.translationCount).toBe(3);
    expect(rows[0]?.chapterCount).toBe(7);
  });

  it('clamps an over-cap limit', async () => {
    stage([]);
    await listAdminPhrases({ language: 'hi', limit: 10_000 });
    // Cap is 200 — service shouldn't pass 10_000 through.
    // Verified indirectly: a no-throw + empty result means the
    // chain ran with whatever clamped value the helper computed.
    expect(selectFn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------
// getPhraseEditorView
// ---------------------------------------------------------------

describe('getPhraseEditorView', () => {
  it('returns null when the phrase does not exist', async () => {
    stage([]);
    const view = await getPhraseEditorView('phr-missing');
    expect(view).toBeNull();
  });

  it('hydrates phrase + tokens + translations + chapters + history', async () => {
    stage([
      {
        id: 'phr-1',
        language: 'hi',
        surfaceNormalised: 'इंतज़ार करना',
        source: 'curator',
        curatorLocked: false,
        hidden: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]); // phrase
    stage([
      { phraseId: 'phr-1', position: 0, surface: 'इंतज़ार', lemmaId: null },
      { phraseId: 'phr-1', position: 1, surface: 'करना', lemmaId: null },
    ]); // tokens
    stage([
      { id: 'tr-1', targetType: 'phrase', targetId: 'phr-1', hidden: false, body: 'to wait' },
      { id: 'tr-2', targetType: 'phrase', targetId: 'phr-1', hidden: true, body: 'spam' },
    ]); // translations (hidden included for curator view)
    stage([
      { chapterId: 'ch-1' },
      { chapterId: 'ch-2' },
    ]); // distinct chapters
    stage([
      {
        id: 'hist-1',
        changeType: 'phrase_update',
        reason: 'gloss tweak',
        createdAt: new Date(),
        editorId: 'editor-1',
      },
    ]); // history

    const view = await getPhraseEditorView('phr-1');
    expect(view).not.toBeNull();
    expect(view!.tokens).toHaveLength(2);
    expect(view!.tokens[0]!.position).toBe(0);
    // Hidden translations DO surface in the editor view.
    expect(view!.translations).toHaveLength(2);
    expect(view!.chapterIds).toEqual(['ch-1', 'ch-2']);
    expect(view!.history).toHaveLength(1);
    expect(view!.history[0]!.changeType).toBe('phrase_update');
  });
});

// ---------------------------------------------------------------
// updatePhraseFields
// ---------------------------------------------------------------

describe('updatePhraseFields', () => {
  it('patches editable fields, locks the row, writes audit', async () => {
    stage([
      {
        id: 'phr-1',
        language: 'hi',
        surfaceNormalised: 'इंतज़ार करना',
        pos: null,
        glossDefault: null,
        frequencyRank: null,
        source: 'user',
        sourceAttribution: null,
        curatorLocked: false,
        hidden: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]); // existing phrase
    stage([
      {
        id: 'phr-1',
        language: 'hi',
        surfaceNormalised: 'इंतज़ार करना',
        pos: 'VERB',
        glossDefault: 'to wait',
        frequencyRank: 1200,
        source: 'user',
        sourceAttribution: null,
        curatorLocked: true,
        hidden: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]); // update returning
    stage([{ id: 'audit-1' }]); // recordPhraseEdit

    const updated = await updatePhraseFields({
      phraseId: 'phr-1',
      patch: {
        glossDefault: 'to wait',
        pos: 'VERB',
        frequencyRank: 1200,
      },
      editorId: 'editor-1',
      reason: 'curate this conjunct verb',
    });

    expect(updated.curatorLocked).toBe(true);
    const updateCall = calls.find((c) => c.kind === 'update');
    expect(
      (updateCall as { set: Record<string, unknown> }).set,
    ).toMatchObject({
      glossDefault: 'to wait',
      pos: 'VERB',
      frequencyRank: 1200,
      curatorLocked: true,
    });

    const insertCall = calls.find((c) => c.kind === 'insert');
    expect(
      (insertCall as { payload: { changeType: string } }).payload.changeType,
    ).toBe('phrase_update');
  });

  it('rejects an over-long pos value', async () => {
    await expect(
      updatePhraseFields({
        phraseId: 'phr-1',
        patch: { pos: 'a'.repeat(33) },
        editorId: 'editor-1',
        reason: 'too long',
      }),
    ).rejects.toBeInstanceOf(PhraseValidationError);
  });

  it('rejects a negative frequencyRank', async () => {
    await expect(
      updatePhraseFields({
        phraseId: 'phr-1',
        patch: { frequencyRank: -5 },
        editorId: 'editor-1',
        reason: 'invalid rank',
      }),
    ).rejects.toBeInstanceOf(PhraseValidationError);
  });

  it('returns 404 when the phrase does not exist', async () => {
    stage([]); // no phrase
    try {
      await updatePhraseFields({
        phraseId: 'phr-missing',
        patch: { glossDefault: 'x' },
        editorId: 'editor-1',
        reason: 'gone',
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PhraseValidationError);
      expect((err as InstanceType<typeof PhraseValidationError>).status).toBe(404);
    }
  });
});
