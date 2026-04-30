// @vitest-environment node
/**
 * Unit tests for the phrase-span resolver (T-14.2).
 *
 * `resolveSpans` is pure — feed it tokens and phrase entries and
 * assert the output. The DB-bound `rebuildChapterSpans` and
 * `loadChapterPhraseSpans` are exercised via a staged Drizzle mock
 * mirroring the pattern in `phrases.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resolveSpans,
  type PhraseLookupEntry,
  type ResolverToken,
} from './phrase-spans.js';

// ---------------------------------------------------------------
// resolveSpans — pure matcher
// ---------------------------------------------------------------

const CHAPTER = '00000000-0000-0000-0000-0000000000aa';

function tok(
  idx: number,
  surface: string,
  opts: { isWord?: boolean; sentenceIdx?: number } = {},
): ResolverToken {
  return {
    idx,
    surface,
    isWord: opts.isWord ?? true,
    sentenceIdx: opts.sentenceIdx ?? 0,
  };
}

describe('resolveSpans — basic matching', () => {
  it('emits a span for a contiguous two-token phrase', () => {
    const tokens = [tok(0, 'मैंने'), tok(1, 'इंतज़ार'), tok(2, 'करना'), tok(3, 'है')];
    const phrases: PhraseLookupEntry[] = [
      { phraseId: 'phr-1', surfaces: ['इंतज़ार', 'करना'] },
    ];
    const spans = resolveSpans(CHAPTER, tokens, phrases);
    expect(spans).toEqual([
      {
        chapterId: CHAPTER,
        phraseId: 'phr-1',
        startTokenIdx: 1,
        endTokenIdx: 2,
      },
    ]);
  });

  it('emits multiple spans for the same phrase occurring twice in a chapter', () => {
    const tokens = [
      tok(0, 'इंतज़ार'),
      tok(1, 'करना'),
      tok(2, 'और'),
      tok(3, 'इंतज़ार'),
      tok(4, 'करना'),
    ];
    const phrases: PhraseLookupEntry[] = [
      { phraseId: 'phr-1', surfaces: ['इंतज़ार', 'करना'] },
    ];
    const spans = resolveSpans(CHAPTER, tokens, phrases);
    expect(spans).toHaveLength(2);
    expect(spans.map((s) => s.startTokenIdx)).toEqual([0, 3]);
  });

  it('emits multiple phrases starting at the same idx (longest-wins is render-time)', () => {
    const tokens = [tok(0, 'मदद'), tok(1, 'करना'), tok(2, 'है')];
    const phrases: PhraseLookupEntry[] = [
      { phraseId: 'phr-short', surfaces: ['मदद', 'करना'] },
      { phraseId: 'phr-long', surfaces: ['मदद', 'करना', 'है'] },
    ];
    const spans = resolveSpans(CHAPTER, tokens, phrases);
    expect(spans).toHaveLength(2);
    const starts = spans.map((s) => s.startTokenIdx);
    expect(starts).toEqual([0, 0]);
    const ends = spans.map((s) => s.endTokenIdx).sort();
    expect(ends).toEqual([1, 2]);
  });
});

describe('resolveSpans — boundary refusal', () => {
  it('refuses to span across a sentence_idx boundary', () => {
    // इंतज़ार | । | करना — the दण्ड mark advances the sentence index.
    const tokens = [
      tok(0, 'इंतज़ार', { sentenceIdx: 0 }),
      tok(1, '।', { isWord: false, sentenceIdx: 0 }),
      tok(2, 'करना', { sentenceIdx: 1 }),
    ];
    const phrases: PhraseLookupEntry[] = [
      { phraseId: 'phr-1', surfaces: ['इंतज़ार', 'करना'] },
    ];
    const spans = resolveSpans(CHAPTER, tokens, phrases);
    // Even setting aside the punctuation between, the sentence_idx
    // change alone is enough to reject — the resolver must not stitch
    // a phrase across a sentence break.
    expect(spans).toEqual([]);
  });

  it('refuses to span a non-word (punctuation) token', () => {
    const tokens = [
      tok(0, 'इंतज़ार'),
      tok(1, ',', { isWord: false }),
      tok(2, 'करना'),
    ];
    const phrases: PhraseLookupEntry[] = [
      { phraseId: 'phr-1', surfaces: ['इंतज़ार', 'करना'] },
    ];
    const spans = resolveSpans(CHAPTER, tokens, phrases);
    expect(spans).toEqual([]);
  });

  it('rejects a partial match at the end of the chapter', () => {
    const tokens = [tok(0, 'और'), tok(1, 'इंतज़ार')];
    const phrases: PhraseLookupEntry[] = [
      { phraseId: 'phr-1', surfaces: ['इंतज़ार', 'करना'] },
    ];
    expect(resolveSpans(CHAPTER, tokens, phrases)).toEqual([]);
  });

  it('does not start a span on a non-word leading token', () => {
    const tokens = [tok(0, '“', { isWord: false }), tok(1, 'करना')];
    const phrases: PhraseLookupEntry[] = [
      { phraseId: 'phr-1', surfaces: ['“', 'करना'] },
    ];
    // First-token must be a word — punctuation cannot anchor a phrase.
    expect(resolveSpans(CHAPTER, tokens, phrases)).toEqual([]);
  });
});

describe('resolveSpans — out-of-order tokens', () => {
  it('handles unsorted token input by sorting on idx', () => {
    const tokens = [tok(2, 'करना'), tok(0, 'इंतज़ार'), tok(1, 'इंतज़ार')];
    const phrases: PhraseLookupEntry[] = [
      { phraseId: 'phr-1', surfaces: ['इंतज़ार', 'करना'] },
    ];
    // After sorting: idx 0 'इंतज़ार', idx 1 'इंतज़ार', idx 2 'करना'.
    // The phrase matches starting at idx 1 only.
    const spans = resolveSpans(CHAPTER, tokens, phrases);
    expect(spans).toEqual([
      {
        chapterId: CHAPTER,
        phraseId: 'phr-1',
        startTokenIdx: 1,
        endTokenIdx: 2,
      },
    ]);
  });
});

// ---------------------------------------------------------------
// rebuildChapterSpans + loadChapterPhraseSpans — DB-bound
// ---------------------------------------------------------------

type Call =
  | { kind: 'select' }
  | { kind: 'insert'; payload?: unknown }
  | { kind: 'delete' };
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
  chain.then = (resolve: (v: unknown) => unknown) => resolve(nextStaged());
  return chain as unknown;
}
function makeInsertChain() {
  const chain = {
    values: vi.fn((payload: unknown) => {
      calls.push({ kind: 'insert', payload });
      return chain;
    }),
  };
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
const insertFn = vi.fn(() => makeInsertChain());
const deleteFn = vi.fn(() => makeDeleteChain());

vi.mock('../db/index.js', () => ({
  db: {
    select: () => selectFn(),
    insert: () => insertFn(),
    delete: () => deleteFn(),
  },
  schema: {
    textTokens: {
      idx: 'text_tokens.idx',
      surface: 'text_tokens.surface',
      isWord: 'text_tokens.is_word',
      sentenceIdx: 'text_tokens.sentence_idx',
      chapterId: 'text_tokens.chapter_id',
    },
    phrases: {
      id: 'phrases.id',
      language: 'phrases.language',
      glossDefault: 'phrases.gloss_default',
    },
    phraseTokens: {
      phraseId: 'phrase_tokens.phrase_id',
      position: 'phrase_tokens.position',
      surface: 'phrase_tokens.surface',
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
  },
}));

const { rebuildChapterSpans, loadChapterPhraseSpans } = await import(
  './phrase-spans.js'
);

beforeEach(() => {
  calls.length = 0;
  staged.length = 0;
  selectFn.mockClear();
  insertFn.mockClear();
  deleteFn.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('rebuildChapterSpans', () => {
  it('clears stale spans and writes nothing when the chapter has no tokens', async () => {
    stage([]); // text_tokens fetch — empty
    const written = await rebuildChapterSpans({
      chapterId: CHAPTER,
      language: 'hi',
    });
    expect(written).toBe(0);
    // Single DELETE call (stale-span cleanup), zero INSERTs.
    expect(calls.filter((c) => c.kind === 'delete')).toHaveLength(1);
    expect(calls.filter((c) => c.kind === 'insert')).toHaveLength(0);
  });

  it('clears stale spans when the language has no phrases', async () => {
    stage([
      { idx: 0, surface: 'a', isWord: true, sentenceIdx: 0 },
      { idx: 1, surface: 'b', isWord: true, sentenceIdx: 0 },
    ]); // tokens
    stage([]); // phrases SELECT — empty
    const written = await rebuildChapterSpans({
      chapterId: CHAPTER,
      language: 'hi',
    });
    expect(written).toBe(0);
    expect(calls.filter((c) => c.kind === 'delete')).toHaveLength(1);
    expect(calls.filter((c) => c.kind === 'insert')).toHaveLength(0);
  });

  it('rebuilds spans end-to-end (delete + insert) on a happy path', async () => {
    stage([
      { idx: 0, surface: 'इंतज़ार', isWord: true, sentenceIdx: 0 },
      { idx: 1, surface: 'करना', isWord: true, sentenceIdx: 0 },
      { idx: 2, surface: 'और', isWord: true, sentenceIdx: 0 },
    ]); // text_tokens
    stage([{ id: 'phr-1' }]); // phrases for language
    stage([
      { phraseId: 'phr-1', position: 0, surface: 'इंतज़ार' },
      { phraseId: 'phr-1', position: 1, surface: 'करना' },
    ]); // phrase_tokens

    const written = await rebuildChapterSpans({
      chapterId: CHAPTER,
      language: 'hi',
    });
    expect(written).toBe(1);
    expect(calls.filter((c) => c.kind === 'delete')).toHaveLength(1);
    const insertCalls = calls.filter((c) => c.kind === 'insert');
    expect(insertCalls).toHaveLength(1);
    const payload = (insertCalls[0] as { payload: unknown[] }).payload;
    expect(payload).toEqual([
      {
        chapterId: CHAPTER,
        phraseId: 'phr-1',
        startTokenIdx: 0,
        endTokenIdx: 1,
      },
    ]);
  });
});

describe('loadChapterPhraseSpans', () => {
  it('returns an empty array when the chapter has no spans', async () => {
    stage([]); // span SELECT
    const result = await loadChapterPhraseSpans(CHAPTER, 'user-1');
    expect(result).toEqual([]);
  });

  it('hydrates gloss + status for each span', async () => {
    stage([
      { phraseId: 'phr-1', startTokenIdx: 0, endTokenIdx: 1 },
      { phraseId: 'phr-2', startTokenIdx: 4, endTokenIdx: 6 },
    ]); // spans
    stage([
      { id: 'phr-1', glossDefault: 'to wait' },
      { id: 'phr-2', glossDefault: null },
    ]); // phrase meta
    stage([
      { phraseId: 'phr-1', status: 'known' },
      { phraseId: 'phr-99', status: 'learning' }, // unrelated row — must be filtered out
    ]); // user_known_phrases

    const result = await loadChapterPhraseSpans(CHAPTER, 'user-1');
    expect(result).toEqual([
      {
        phraseId: 'phr-1',
        startTokenIdx: 0,
        endTokenIdx: 1,
        glossDefault: 'to wait',
        status: 'known',
      },
      {
        phraseId: 'phr-2',
        startTokenIdx: 4,
        endTokenIdx: 6,
        glossDefault: null,
        status: 'unknown',
      },
    ]);
  });

  it('falls back to status="unknown" for anonymous viewers (no user_known_phrases query)', async () => {
    stage([{ phraseId: 'phr-1', startTokenIdx: 0, endTokenIdx: 1 }]);
    stage([{ id: 'phr-1', glossDefault: 'to wait' }]);
    // No third stage — anonymous viewer skips the user_known_phrases SELECT.

    const result = await loadChapterPhraseSpans(CHAPTER, null);
    expect(result).toEqual([
      {
        phraseId: 'phr-1',
        startTokenIdx: 0,
        endTokenIdx: 1,
        glossDefault: 'to wait',
        status: 'unknown',
      },
    ]);
    // Two SELECTs: spans + phrase meta. No user_known_phrases scan.
    expect(calls.filter((c) => c.kind === 'select')).toHaveLength(2);
  });
});
