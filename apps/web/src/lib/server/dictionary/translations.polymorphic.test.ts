// @vitest-environment node
/**
 * Polymorphic translation tests (T-14.1).
 *
 * Verifies that the new phrase-target path
 * (`submitUserPhraseTranslation`) writes the polymorphic columns
 * correctly and that the existing lemma-target path
 * (`submitUserTranslation`) keeps populating both legacy `lemma_id`
 * AND the canonical (target_type, target_id) pair during the
 * overlap window.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Call =
  | { kind: 'select' }
  | { kind: 'insert'; payload?: unknown };
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
  chain.limit = vi.fn(() => chain);
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

const selectFn = vi.fn(() => {
  calls.push({ kind: 'select' });
  return makeSelectChain();
});
const insertFn = vi.fn(() => makeInsertChain());

vi.mock('../db/index.js', () => ({
  db: {
    select: () => selectFn(),
    insert: () => insertFn(),
  },
  schema: {
    lemmas: { id: 'lemmas.id' },
    phrases: { id: 'phrases.id' },
    translations: {
      id: 'translations.id',
      lemmaId: 'translations.lemma_id',
      targetType: 'translations.target_type',
      targetId: 'translations.target_id',
      submittedBy: 'translations.submitted_by',
      createdAt: 'translations.created_at',
    },
  },
}));

const {
  submitUserTranslation,
  submitUserPhraseTranslation,
  TranslationValidationError,
} = await import('./translations.js');

beforeEach(() => {
  calls.length = 0;
  staged.length = 0;
  selectFn.mockClear();
  insertFn.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------
// submitUserTranslation (lemma target — overlap-window write shape)
// ---------------------------------------------------------------

describe('submitUserTranslation — polymorphic write shape', () => {
  it('writes only the polymorphic (target_type, target_id) pair (T-14.7a dropped lemma_id)', async () => {
    stage([{ id: 'lemma-1' }]); // existence check
    stage([{ n: 0 }]); // rate-limit count
    stage([
      {
        id: 'tr-1',
        targetType: 'lemma',
        targetId: 'lemma-1',
        source: 'user',
        submittedBy: 'user-1',
        body: 'to speak',
        hidden: false,
      },
    ]);

    await submitUserTranslation('user-1', {
      lemmaId: 'lemma-1',
      body: 'to speak',
    });

    const insertCall = calls.find((c) => c.kind === 'insert');
    expect(insertCall?.payload).toMatchObject({
      targetType: 'lemma',
      targetId: 'lemma-1',
      source: 'user',
    });
    // T-14.7a: lemma_id is no longer written.
    expect(
      (insertCall?.payload as Record<string, unknown> | undefined)?.lemmaId,
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------
// submitUserPhraseTranslation (phrase target)
// ---------------------------------------------------------------

describe('submitUserPhraseTranslation — happy path', () => {
  it('writes lemma_id=null + (target_type=phrase, target_id=phraseId)', async () => {
    stage([{ id: 'phr-1' }]); // phrase existence
    stage([{ n: 0 }]); // rate-limit
    stage([
      {
        id: 'tr-1',
        lemmaId: null,
        targetType: 'phrase',
        targetId: 'phr-1',
        source: 'user',
        submittedBy: 'user-1',
        body: 'to wait',
      },
    ]);

    const result = await submitUserPhraseTranslation('user-1', {
      phraseId: 'phr-1',
      body: 'to wait',
    });

    expect(result.targetType).toBe('phrase');
    expect(result.targetId).toBe('phr-1');

    const insertCall = calls.find((c) => c.kind === 'insert');
    // T-14.7a: legacy lemma_id field is gone — the insert
    // payload only carries the polymorphic pair.
    expect(insertCall?.payload).toMatchObject({
      targetType: 'phrase',
      targetId: 'phr-1',
      source: 'user',
      submittedBy: 'user-1',
      body: 'to wait',
      targetLanguage: 'en',
    });
    // Sanity: lemma_id is no longer written.
    expect(
      (insertCall?.payload as Record<string, unknown> | undefined)?.lemmaId,
    ).toBeUndefined();
  });

  it('rate-limit is shared with the lemma path (same submittedBy window)', async () => {
    stage([{ id: 'phr-1' }]); // phrase existence
    stage([{ n: 30 }]); // already at the cap from lemma submissions
    await expect(
      submitUserPhraseTranslation('user-1', { phraseId: 'phr-1', body: 'x' }),
    ).rejects.toThrow();
  });
});

describe('submitUserPhraseTranslation — validation errors', () => {
  it('rejects an empty body without touching the DB', async () => {
    await expect(
      submitUserPhraseTranslation('user-1', { phraseId: 'phr-1', body: '   ' }),
    ).rejects.toBeInstanceOf(TranslationValidationError);
    expect(selectFn).not.toHaveBeenCalled();
  });

  it('returns a 404-flavoured error when the phrase does not exist', async () => {
    stage([]); // phrase missing
    try {
      await submitUserPhraseTranslation('user-1', {
        phraseId: 'phr-missing',
        body: 'x',
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TranslationValidationError);
      expect((err as InstanceType<typeof TranslationValidationError>).status).toBe(404);
    }
  });

  it('rejects a parent translation that targets a different phrase', async () => {
    stage([{ id: 'phr-1' }]); // phrase exists
    stage([
      {
        id: 'parent-1',
        targetType: 'phrase',
        targetId: 'phr-OTHER',
      },
    ]); // parent on a different phrase
    await expect(
      submitUserPhraseTranslation('user-1', {
        phraseId: 'phr-1',
        body: 'x',
        parentTranslationId: 'parent-1',
      }),
    ).rejects.toBeInstanceOf(TranslationValidationError);
  });

  it('rejects a parent translation that targets a lemma instead', async () => {
    stage([{ id: 'phr-1' }]);
    stage([
      {
        id: 'parent-1',
        targetType: 'lemma',
        targetId: 'phr-1', // value happens to match phraseId — must still reject
      },
    ]);
    await expect(
      submitUserPhraseTranslation('user-1', {
        phraseId: 'phr-1',
        body: 'x',
        parentTranslationId: 'parent-1',
      }),
    ).rejects.toBeInstanceOf(TranslationValidationError);
  });
});
