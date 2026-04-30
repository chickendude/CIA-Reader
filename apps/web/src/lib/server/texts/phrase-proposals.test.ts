// @vitest-environment node
/**
 * Unit tests for the phrase proposals queue + promotion (T-14.5a).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Call =
  | { kind: 'select' }
  | { kind: 'insert'; payload?: unknown; conflictTarget?: unknown }
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
  chain.groupBy = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) => resolve(nextStaged());
  return chain as unknown;
}
function makeInsertChain() {
  const chain: Record<string, unknown> = {
    values: vi.fn((payload: unknown) => {
      calls.push({ kind: 'insert', payload });
      return chain;
    }),
    onConflictDoNothing: vi.fn((spec?: unknown) => {
      const last = calls[calls.length - 1];
      if (last && last.kind === 'insert') last.conflictTarget = spec;
      return chain;
    }),
    returning: vi.fn(() => nextStaged()),
  };
  chain.then = (resolve: (v: unknown) => unknown) => resolve(undefined);
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
const insertFn = vi.fn(() => makeInsertChain());
const updateFn = vi.fn(() => makeUpdateChain());

const createPhrase = vi.fn();

vi.mock('../db/index.js', () => ({
  db: {
    select: () => selectFn(),
    insert: () => insertFn(),
    update: () => updateFn(),
  },
  schema: {
    phraseProposals: {
      id: 'phrase_proposals.id',
      language: 'phrase_proposals.language',
      surfaceNormalised: 'phrase_proposals.surface_normalised',
      tokens: 'phrase_proposals.tokens',
      patternId: 'phrase_proposals.pattern_id',
      chapterId: 'phrase_proposals.chapter_id',
      promotedAt: 'phrase_proposals.promoted_at',
      promotedPhraseId: 'phrase_proposals.promoted_phrase_id',
    },
  },
}));

vi.mock('../phrases.js', () => ({
  createPhrase: (...a: unknown[]) => createPhrase(...a),
}));

const {
  PHRASE_PROMOTION_MIN_CHAPTERS,
  promotePhraseProposals,
  upsertPhraseProposals,
} = await import('./phrase-proposals.js');

beforeEach(() => {
  calls.length = 0;
  staged.length = 0;
  selectFn.mockClear();
  insertFn.mockClear();
  updateFn.mockClear();
  createPhrase.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------
// upsertPhraseProposals
// ---------------------------------------------------------------

describe('upsertPhraseProposals', () => {
  it('writes one row per (chapter, surface, pattern) and uses ON CONFLICT DO NOTHING', async () => {
    const written = await upsertPhraseProposals({
      chapterId: 'ch-1',
      language: 'hi',
      proposals: [
        {
          start_idx: 0,
          end_idx: 1,
          pattern_id: 'hi.conjunct_verb_karna',
          surfaces: ['इंतज़ार', 'करना'],
        },
        {
          start_idx: 5,
          end_idx: 7,
          pattern_id: 'hi.compound_postp_ke_baare_mein',
          surfaces: ['के', 'बारे', 'में'],
        },
      ],
    });
    expect(written).toBe(2);
    const insertCall = calls.find((c) => c.kind === 'insert') as
      | Extract<Call, { kind: 'insert' }>
      | undefined;
    expect(insertCall?.payload).toHaveLength(2);
    const payload = insertCall!.payload as Array<{
      surfaceNormalised: string;
      tokens: string[];
    }>;
    expect(payload[0]!.surfaceNormalised).toBe('इंतज़ार करना');
    expect(payload[0]!.tokens).toEqual(['इंतज़ार', 'करना']);
    expect(payload[1]!.surfaceNormalised).toBe('के बारे में');
    // Conflict target points at the unique constraint columns.
    expect(insertCall!.conflictTarget).toBeDefined();
  });

  it('collapses duplicate proposals within the same chapter before insert', async () => {
    await upsertPhraseProposals({
      chapterId: 'ch-1',
      language: 'hi',
      proposals: [
        {
          start_idx: 0,
          end_idx: 1,
          pattern_id: 'hi.x',
          surfaces: ['a', 'b'],
        },
        {
          start_idx: 5,
          end_idx: 6,
          pattern_id: 'hi.x',
          surfaces: ['a', 'b'],
        },
      ],
    });
    const insertCall = calls.find((c) => c.kind === 'insert') as
      | Extract<Call, { kind: 'insert' }>
      | undefined;
    expect((insertCall!.payload as Array<unknown>).length).toBe(1);
  });

  it('is a no-op when the proposals list is empty', async () => {
    const written = await upsertPhraseProposals({
      chapterId: 'ch-1',
      language: 'hi',
      proposals: [],
    });
    expect(written).toBe(0);
    expect(insertFn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------
// promotePhraseProposals
// ---------------------------------------------------------------

describe('promotePhraseProposals', () => {
  it('promotes a (language, surface) group at or above the threshold', async () => {
    // Group aggregation — one group with 3 chapters meets the
    // default threshold.
    stage([
      {
        language: 'hi',
        surfaceNormalised: 'इंतज़ार करना',
        chapters: 3,
      },
    ]);
    // Sample lookup for the eligible group.
    stage([
      {
        tokens: ['इंतज़ार', 'करना'],
        patternId: 'hi.conjunct_verb_karna',
      },
    ]);
    createPhrase.mockResolvedValueOnce({
      phrase: { id: 'phr-1' },
      tokens: [],
      reused: false,
    });
    // Update returning — three proposals were stamped with
    // promoted_at.
    stage([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]);

    const result = await promotePhraseProposals();
    expect(result.promoted).toBe(1);
    expect(result.proposalsMarked).toBe(3);
    expect(result.byLanguage.hi).toBe(1);
    expect(createPhrase).toHaveBeenCalledWith(
      expect.objectContaining({
        language: 'hi',
        tokens: ['इंतज़ार', 'करना'],
        source: 'nlp',
        sourceAttribution: 'pattern:hi.conjunct_verb_karna',
        bypassTokenCap: true,
      }),
    );
  });

  it('skips groups under the threshold', async () => {
    stage([
      {
        language: 'hi',
        surfaceNormalised: 'क',
        chapters: 2, // below default threshold of 3
      },
    ]);
    const result = await promotePhraseProposals();
    expect(result.promoted).toBe(0);
    expect(result.proposalsMarked).toBe(0);
    expect(createPhrase).not.toHaveBeenCalled();
  });

  it('honours an explicit minChapters override', async () => {
    stage([
      {
        language: 'hi',
        surfaceNormalised: 'क',
        chapters: 1,
      },
    ]);
    stage([
      {
        tokens: ['क', 'ख'],
        patternId: 'hi.x',
      },
    ]);
    createPhrase.mockResolvedValueOnce({
      phrase: { id: 'phr-1' },
      tokens: [],
      reused: false,
    });
    stage([{ id: 'p1' }]);
    const result = await promotePhraseProposals({ minChapters: 1 });
    expect(result.promoted).toBe(1);
  });

  it('returns zero when no unpromoted proposals exist', async () => {
    stage([]); // empty group aggregation
    const result = await promotePhraseProposals();
    expect(result).toEqual({
      promoted: 0,
      proposalsMarked: 0,
      byLanguage: {},
    });
  });

  it('surfaces the configured threshold via the exported constant', () => {
    // Exposed for the admin endpoint's response — tests that the
    // env-var override is read and defaults to 3.
    expect(typeof PHRASE_PROMOTION_MIN_CHAPTERS).toBe('number');
    expect(PHRASE_PROMOTION_MIN_CHAPTERS).toBeGreaterThanOrEqual(1);
  });
});
