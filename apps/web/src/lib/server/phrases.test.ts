// @vitest-environment node
/**
 * Unit tests for the phrase service (T-14.1).
 *
 * Drizzle is mocked via the staged-result chain pattern used by
 * `dictionary/translations.test.ts` — every chained call resolves
 * to the next staged result, so the test asserts the service hits
 * the DB in the expected order.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Call =
  | { kind: 'select' }
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
  // Not all updates use `.returning()` — the cache-recompute UPDATE
  // is awaited directly. Resolve the chain itself for that path.
  chain.then = (resolve: (v: unknown) => unknown) => resolve(undefined);
  return chain;
}

const selectFn = vi.fn(() => {
  calls.push({ kind: 'select' });
  return makeSelectChain();
});
const insertFn = vi.fn(() => makeInsertChain());
const updateFn = vi.fn(() => makeUpdateChain());

vi.mock('./db/index.js', () => ({
  db: {
    select: () => selectFn(),
    insert: () => insertFn(),
    update: () => updateFn(),
  },
  schema: {
    phrases: {
      id: 'phrases.id',
      language: 'phrases.language',
      surfaceNormalised: 'phrases.surface_normalised',
      source: 'phrases.source',
    },
    phraseTokens: {
      phraseId: 'phrase_tokens.phrase_id',
      surface: 'phrase_tokens.surface',
    },
    translations: {
      targetType: 'translations.target_type',
      targetId: 'translations.target_id',
      hidden: 'translations.hidden',
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
  createPhrase,
  getPhrase,
  setKnownPhraseStatus,
  PhraseValidationError,
  MAX_PHRASE_TOKENS,
} = await import('./phrases.js');

beforeEach(() => {
  calls.length = 0;
  staged.length = 0;
  selectFn.mockClear();
  insertFn.mockClear();
  updateFn.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------
// createPhrase
// ---------------------------------------------------------------

describe('createPhrase — happy path', () => {
  it('inserts the phrase + ordered tokens and returns reused=false', async () => {
    stage([]); // dedupe lookup — no existing match
    stage([
      {
        id: 'phr-1',
        language: 'hi',
        surfaceNormalised: 'इंतज़ार करना',
        source: 'user',
      },
    ]); // phrases insert
    stage([
      { phraseId: 'phr-1', position: 0, surface: 'इंतज़ार', lemmaId: null },
      { phraseId: 'phr-1', position: 1, surface: 'करना', lemmaId: null },
    ]); // phrase_tokens insert

    const result = await createPhrase({
      language: 'hi',
      tokens: ['इंतज़ार', 'करना'],
      source: 'user',
      submittedBy: 'user-1',
    });

    expect(result.reused).toBe(false);
    expect(result.phrase.id).toBe('phr-1');
    expect(result.tokens).toHaveLength(2);
    expect(result.tokens[0]?.position).toBe(0);
    expect(result.tokens[1]?.surface).toBe('करना');
    // Two inserts: one for the phrase, one for phrase_tokens.
    expect(calls.filter((c) => c.kind === 'insert')).toHaveLength(2);
  });

  it('NFC-normalises and trims token surfaces before persisting', async () => {
    stage([]); // dedupe miss
    stage([
      { id: 'phr-2', language: 'hi', surfaceNormalised: 'a b', source: 'user' },
    ]);
    stage([
      { phraseId: 'phr-2', position: 0, surface: 'a', lemmaId: null },
      { phraseId: 'phr-2', position: 1, surface: 'b', lemmaId: null },
    ]);

    await createPhrase({
      language: 'hi',
      tokens: ['  a  ', ' b '],
      source: 'user',
      submittedBy: 'user-1',
    });

    const phraseInsertCall = calls.filter((c) => c.kind === 'insert')[0];
    expect((phraseInsertCall as { payload: { surfaceNormalised: string } }).payload.surfaceNormalised).toBe('a b');
  });
});

describe('createPhrase — dedupe', () => {
  it('returns the existing phrase + tokens with reused=true on a (lang,surface,source) hit', async () => {
    stage([
      {
        id: 'phr-existing',
        language: 'hi',
        surfaceNormalised: 'इंतज़ार करना',
        source: 'user',
      },
    ]); // dedupe hit
    stage([
      { phraseId: 'phr-existing', position: 0, surface: 'इंतज़ार', lemmaId: null },
      { phraseId: 'phr-existing', position: 1, surface: 'करना', lemmaId: null },
    ]); // existing phrase_tokens lookup

    const result = await createPhrase({
      language: 'hi',
      tokens: ['इंतज़ार', 'करना'],
      source: 'user',
      submittedBy: 'user-2',
    });

    expect(result.reused).toBe(true);
    expect(result.phrase.id).toBe('phr-existing');
    // No insert calls — pure dedupe path.
    expect(calls.filter((c) => c.kind === 'insert')).toHaveLength(0);
  });
});

describe('createPhrase — validation', () => {
  it('rejects a single-token phrase (use lemmas instead)', async () => {
    await expect(
      createPhrase({
        language: 'hi',
        tokens: ['नमस्ते'],
        source: 'user',
        submittedBy: 'u',
      }),
    ).rejects.toBeInstanceOf(PhraseValidationError);
    expect(selectFn).not.toHaveBeenCalled();
  });

  it('rejects a phrase exceeding MAX_PHRASE_TOKENS for non-curators', async () => {
    const tokens = Array.from({ length: MAX_PHRASE_TOKENS + 1 }, (_, i) => `t${i}`);
    await expect(
      createPhrase({
        language: 'hi',
        tokens,
        source: 'user',
        submittedBy: 'u',
      }),
    ).rejects.toBeInstanceOf(PhraseValidationError);
  });

  it('allows a curator to bypass MAX_PHRASE_TOKENS', async () => {
    const tokens = Array.from({ length: MAX_PHRASE_TOKENS + 2 }, (_, i) => `t${i}`);
    stage([]); // dedupe miss
    stage([
      {
        id: 'phr-long',
        language: 'hi',
        surfaceNormalised: tokens.join(' '),
        source: 'curator',
      },
    ]);
    stage(
      tokens.map((surface, position) => ({
        phraseId: 'phr-long',
        position,
        surface,
        lemmaId: null,
      })),
    );
    const result = await createPhrase({
      language: 'hi',
      tokens,
      source: 'curator',
      bypassTokenCap: true,
    });
    expect(result.tokens).toHaveLength(tokens.length);
  });

  it('rejects a punctuation-only token', async () => {
    await expect(
      createPhrase({
        language: 'hi',
        tokens: ['कर', '।'],
        source: 'user',
        submittedBy: 'u',
      }),
    ).rejects.toBeInstanceOf(PhraseValidationError);
  });

  it('rejects an empty-string token after trim', async () => {
    await expect(
      createPhrase({
        language: 'hi',
        tokens: ['कर', '   '],
        source: 'user',
        submittedBy: 'u',
      }),
    ).rejects.toBeInstanceOf(PhraseValidationError);
  });
});

// ---------------------------------------------------------------
// getPhrase
// ---------------------------------------------------------------

describe('getPhrase', () => {
  it('returns null when the phrase does not exist', async () => {
    stage([]); // miss
    const result = await getPhrase('11111111-1111-1111-1111-111111111111');
    expect(result).toBeNull();
  });

  it('hydrates phrase + tokens (sorted by position) + visible translations', async () => {
    stage([
      {
        id: 'phr-1',
        language: 'hi',
        surfaceNormalised: 'इंतज़ार करना',
        source: 'user',
      },
    ]); // phrase
    stage([
      { phraseId: 'phr-1', position: 1, surface: 'करना', lemmaId: null },
      { phraseId: 'phr-1', position: 0, surface: 'इंतज़ार', lemmaId: null },
    ]); // tokens — out of order on purpose
    stage([
      {
        id: 'tr-1',
        targetType: 'phrase',
        targetId: 'phr-1',
        body: 'to wait',
        hidden: false,
      },
    ]); // translations

    const result = await getPhrase('phr-1');
    expect(result?.tokens.map((t) => t.position)).toEqual([0, 1]);
    expect(result?.translations).toHaveLength(1);
  });
});

// ---------------------------------------------------------------
// setKnownPhraseStatus
// ---------------------------------------------------------------

describe('setKnownPhraseStatus', () => {
  it('inserts a row when none exists and recomputes the language counter', async () => {
    stage([{ id: 'phr-1', language: 'hi' }]); // phrase lookup
    stage([]); // existing user_known_phrases for this user — none
    stage([
      {
        userId: 'user-1',
        phraseId: 'phr-1',
        status: 'known',
        updatedAt: new Date('2026-04-30'),
      },
    ]); // insert
    stage([{ phraseId: 'phr-1', language: 'hi' }]); // counter recompute select
    // (final UPDATE on user_languages goes to the chain.then path,
    // resolves to undefined — no stage needed.)

    const row = await setKnownPhraseStatus({
      userId: 'user-1',
      phraseId: 'phr-1',
      status: 'known',
    });

    expect(row.status).toBe('known');
    // INSERT (status row) — UPDATE happens for the cache.
    expect(calls.filter((c) => c.kind === 'insert')).toHaveLength(1);
    expect(calls.filter((c) => c.kind === 'update')).toHaveLength(1);
    const updateCall = calls.find((c) => c.kind === 'update');
    expect((updateCall as { set: { knownPhrasesCountCache: number } }).set.knownPhrasesCountCache).toBe(1);
  });

  it('updates an existing row and refreshes the counter', async () => {
    stage([{ id: 'phr-1', language: 'hi' }]);
    stage([
      {
        userId: 'user-1',
        phraseId: 'phr-1',
        status: 'learning',
        updatedAt: new Date('2026-04-29'),
      },
    ]); // existing row
    stage([
      {
        userId: 'user-1',
        phraseId: 'phr-1',
        status: 'known',
        updatedAt: new Date('2026-04-30'),
      },
    ]); // update returning
    stage([
      { phraseId: 'phr-1', language: 'hi' },
      { phraseId: 'phr-9', language: 'hi' },
    ]); // counter recompute — two known phrases for hi

    const row = await setKnownPhraseStatus({
      userId: 'user-1',
      phraseId: 'phr-1',
      status: 'known',
    });
    expect(row.status).toBe('known');
    // Two updates: the status row, then the counter.
    expect(calls.filter((c) => c.kind === 'update')).toHaveLength(2);
    const counterUpdate = calls.filter((c) => c.kind === 'update')[1];
    expect((counterUpdate as { set: { knownPhrasesCountCache: number } }).set.knownPhrasesCountCache).toBe(2);
  });

  it('throws a 404-flavoured error when the phrase does not exist', async () => {
    stage([]); // phrase missing
    try {
      await setKnownPhraseStatus({
        userId: 'user-1',
        phraseId: 'phr-missing',
        status: 'known',
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PhraseValidationError);
      expect((err as InstanceType<typeof PhraseValidationError>).status).toBe(404);
    }
  });
});
