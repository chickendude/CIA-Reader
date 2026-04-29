// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  chain.orderBy = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) => resolve(nextStaged());
  return chain;
}

const selectFn = vi.fn(() => makeSelectChain());

vi.mock('../db/index.js', () => ({
  db: { select: () => selectFn() },
  schema: {
    textTokens: {
      id: 'text_tokens.id',
      chapterId: 'text_tokens.chapter_id',
      idx: 'text_tokens.idx',
      lemmaId: 'text_tokens.lemma_id',
    },
    userKnownLemmas: {
      userId: 'user_known_lemmas.user_id',
      lemmaId: 'user_known_lemmas.lemma_id',
      status: 'user_known_lemmas.status',
    },
    tokenCorrections: {
      userId: 'token_corrections.user_id',
      tokenId: 'token_corrections.token_id',
    },
    lemmas: {
      id: 'lemmas.id',
      glossDefault: 'lemmas.gloss_default',
    },
  },
}));

const { loadChapterTokens, loadKnownStatusMap, listKnownLemmas } =
  await import('./tokens.js');

beforeEach(() => {
  staged.length = 0;
  selectFn.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

function tokenRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tok-1',
    chapterId: 'chap-1',
    idx: 0,
    surface: 'पाठ',
    lemmaId: 'lem-1',
    lemmaCandidates: [],
    features: {},
    isAmbiguous: false,
    isOov: false,
    isWord: true,
    sentenceIdx: 0,
    romanization: null,
    ...overrides,
  };
}

describe('loadChapterTokens', () => {
  it('returns null when no tokens have been written for the chapter yet', async () => {
    stage([]);
    const result = await loadChapterTokens('chap-1', 'user-1');
    expect(result).toBeNull();
  });

  it('returns tokens with status=unknown when the viewer has no known-lemma rows', async () => {
    stage([tokenRow({ id: 't1', idx: 0 }), tokenRow({ id: 't2', idx: 1 })]);
    stage([]); // token_corrections (T-6.4) — none
    stage([]); // user_known_lemmas → empty
    stage([]); // lemmas (gloss lookup) → empty
    const result = await loadChapterTokens('chap-1', 'user-1');
    expect(result).not.toBeNull();
    expect(result!.every((t) => t.status === 'unknown')).toBe(true);
  });

  it('joins user_known_lemmas to colour matching lemmas', async () => {
    stage([
      tokenRow({ id: 't1', idx: 0, lemmaId: 'lem-known' }),
      tokenRow({ id: 't2', idx: 1, lemmaId: 'lem-learning' }),
      tokenRow({ id: 't3', idx: 2, lemmaId: 'lem-other' }),
    ]);
    stage([]); // token_corrections (T-6.4) — none
    stage([
      { userId: 'user-1', lemmaId: 'lem-known', status: 'known' },
      { userId: 'user-1', lemmaId: 'lem-learning', status: 'learning' },
    ]);
    stage([]); // lemmas (gloss lookup) — none on file for these lemmas
    const result = await loadChapterTokens('chap-1', 'user-1');
    expect(result).toEqual([
      expect.objectContaining({ id: 't1', status: 'known' }),
      expect.objectContaining({ id: 't2', status: 'learning' }),
      expect.objectContaining({ id: 't3', status: 'unknown' }),
    ]);
  });

  it('attaches glossDefault from the lemmas table for the hover tooltip (T-5.18)', async () => {
    stage([
      tokenRow({ id: 't1', idx: 0, lemmaId: 'lem-a' }),
      tokenRow({ id: 't2', idx: 1, lemmaId: 'lem-b' }),
      tokenRow({ id: 't3', idx: 2, lemmaId: null, isWord: false, surface: ' ' }),
    ]);
    stage([]); // token_corrections (T-6.4)
    stage([]); // user_known_lemmas
    stage([
      { id: 'lem-a', language: 'hi', headword: 'सुबह', glossDefault: 'morning' },
      { id: 'lem-b', language: 'hi', headword: 'rare', glossDefault: null },
    ]);
    // T-3.14 sibling fallback: lem-b had no gloss, so the loader runs
    // a sibling lookup. No sibling exists for "rare", so an empty
    // result keeps the null gloss as-is.
    stage([]); // sibling fallback — no rows
    const result = await loadChapterTokens('chap-1', 'user-1');
    expect(result![0]).toMatchObject({ id: 't1', glossDefault: 'morning' });
    // Lemma row exists but the gloss column is null AND no sibling has
    // a gloss — should pass through as null.
    expect(result![1]).toMatchObject({ id: 't2', glossDefault: null });
    // Whitespace token has no lemma id; glossDefault defaults to null.
    expect(result![2]).toMatchObject({ id: 't3', glossDefault: null });
  });

  it('falls back to a sibling lemma\'s gloss when the linked lemma has none (T-3.14)', async () => {
    // Common case: NLP tagged "पार्क" as PROPN with no gloss; the
    // dictionary entry is under "पार्क/NOUN" with the actual gloss.
    stage([tokenRow({ id: 't1', idx: 0, lemmaId: 'lem-propn' })]);
    stage([]); // token_corrections (T-6.4)
    stage([]); // user_known_lemmas
    stage([
      { id: 'lem-propn', language: 'hi', headword: 'पार्क', glossDefault: null },
    ]);
    stage([
      { language: 'hi', headword: 'पार्क', glossDefault: 'park' },
    ]);
    const result = await loadChapterTokens('chap-1', 'user-1');
    expect(result![0]).toMatchObject({ id: 't1', glossDefault: 'park' });
  });

  it('skips the sibling fallback query entirely when every lemma has its own gloss (T-3.14)', async () => {
    stage([tokenRow({ id: 't1', idx: 0, lemmaId: 'lem-a' })]);
    stage([]); // token_corrections (T-6.4)
    stage([]); // user_known_lemmas
    stage([{ id: 'lem-a', language: 'hi', headword: 'पानी', glossDefault: 'water' }]);
    // No 5th stage — fallback query must not fire.
    await loadChapterTokens('chap-1', 'user-1');
    // 1 (tokens) + 1 (token_corrections) + 1 (user_known_lemmas) +
    // 1 (gloss lookup) = 4, no sibling fallback.
    expect(selectFn).toHaveBeenCalledTimes(4);
  });

  it('populates token.candidates with metadata pulled from the lemmas table (T-6.1)', async () => {
    stage([
      tokenRow({
        id: 't1',
        idx: 0,
        lemmaId: 'lem-primary',
        isAmbiguous: true,
        lemmaCandidates: [
          { lemmaId: 'lem-primary', features: { Case: 'Nom' }, score: 0.6 },
          { lemmaId: 'lem-alt', features: { Case: 'Acc' }, score: 0.3 },
          // Candidate with no resolved lemma — must be filtered out.
          { lemmaId: null, features: {}, score: 0.1 },
        ],
      }),
    ]);
    stage([]); // token_corrections (T-6.4)
    stage([]); // user_known_lemmas
    stage([
      {
        id: 'lem-primary',
        language: 'hi',
        headword: 'पाठ',
        pos: 'NOUN',
        glossDefault: 'lesson',
      },
      {
        id: 'lem-alt',
        language: 'hi',
        headword: 'पाठ',
        pos: 'VERB',
        glossDefault: 'to read',
      },
    ]);
    const result = await loadChapterTokens('chap-1', 'user-1');
    expect(result![0]).toMatchObject({
      id: 't1',
      isAmbiguous: true,
      glossDefault: 'lesson',
    });
    // The primary's lemma is excluded from the candidate list (the
    // popup never offers the user their already-active pick), the
    // null-lemmaId candidate is dropped, and what remains carries
    // headword + POS + gloss for the popup.
    expect(result![0]!.candidates).toEqual([
      {
        lemmaId: 'lem-alt',
        headword: 'पाठ',
        pos: 'VERB',
        glossDefault: 'to read',
        score: 0.3,
        features: { Case: 'Acc' },
      },
    ]);
  });

  it('applies a pick_candidate correction at read time, swapping the active lemma (T-6.4)', async () => {
    stage([
      tokenRow({
        id: 't1',
        idx: 0,
        lemmaId: 'lem-original',
        isAmbiguous: true,
        lemmaCandidates: [
          { lemmaId: 'lem-original', features: {}, score: 0.6 },
          { lemmaId: 'lem-corrected', features: {}, score: 0.3 },
        ],
      }),
    ]);
    stage([
      {
        userId: 'user-1',
        tokenId: 't1',
        type: 'pick_candidate',
        chosenLemmaId: 'lem-corrected',
      },
    ]);
    stage([]); // user_known_lemmas
    stage([
      {
        id: 'lem-original',
        language: 'hi',
        headword: 'मूल',
        pos: 'NOUN',
        glossDefault: 'original',
      },
      {
        id: 'lem-corrected',
        language: 'hi',
        headword: 'सही',
        pos: 'VERB',
        glossDefault: 'corrected',
      },
    ]);
    const result = await loadChapterTokens('chap-1', 'user-1');
    expect(result![0]).toMatchObject({
      id: 't1',
      lemmaId: 'lem-corrected',
      glossDefault: 'corrected',
    });
    // The previous primary now appears in the candidate list so the
    // user can flip back without leaving the popup.
    const cands = result![0]!.candidates.map((c) => c.lemmaId);
    expect(cands).toContain('lem-original');
    expect(cands).not.toContain('lem-corrected');
  });

  it('mark_proper_noun clears the lemma + sets status=ignored (T-6.4)', async () => {
    stage([
      tokenRow({ id: 't1', idx: 0, lemmaId: 'lem-x', isOov: false }),
    ]);
    stage([
      {
        userId: 'user-1',
        tokenId: 't1',
        type: 'mark_proper_noun',
        chosenLemmaId: null,
      },
    ]);
    stage([]); // user_known_lemmas
    stage([
      {
        id: 'lem-x',
        language: 'hi',
        headword: 'X',
        pos: 'NOUN',
        // Non-null gloss so the sibling-fallback SELECT doesn't fire.
        glossDefault: 'placeholder',
      },
    ]);
    const result = await loadChapterTokens('chap-1', 'user-1');
    expect(result![0]).toMatchObject({
      id: 't1',
      lemmaId: null,
      status: 'ignored',
      isWord: false,
      isOov: false,
    });
  });

  it('handles anonymous viewers (no user_known_lemmas SELECT, every status=unknown)', async () => {
    stage([tokenRow({ id: 't1', idx: 0 })]);
    stage([]); // lemmas (gloss lookup) — only this second SELECT runs
    const result = await loadChapterTokens('chap-1', null);
    expect(result).not.toBeNull();
    expect(result![0]!.status).toBe('unknown');
    // Two SELECTs total — the user_known_lemmas query was skipped, but
    // the lemmas-for-gloss query still runs.
    expect(selectFn).toHaveBeenCalledTimes(2);
  });
});

describe('loadKnownStatusMap', () => {
  it('returns an empty map for anonymous callers', async () => {
    const map = await loadKnownStatusMap(null, ['l1']);
    expect(map.size).toBe(0);
    expect(selectFn).not.toHaveBeenCalled();
  });

  it('returns an empty map when no lemma ids are requested', async () => {
    const map = await loadKnownStatusMap('user-1', []);
    expect(map.size).toBe(0);
    expect(selectFn).not.toHaveBeenCalled();
  });

  it('filters server-returned rows down to the requested lemma id set', async () => {
    stage([
      { userId: 'user-1', lemmaId: 'l1', status: 'known' },
      { userId: 'user-1', lemmaId: 'l2', status: 'learning' },
      { userId: 'user-1', lemmaId: 'l3', status: 'ignored' },
    ]);
    const map = await loadKnownStatusMap('user-1', ['l1', 'l3']);
    expect(map.get('l1')).toBe('known');
    expect(map.get('l3')).toBe('ignored');
    expect(map.has('l2')).toBe(false);
  });
});

describe('listKnownLemmas', () => {
  it('returns every known-lemma row for the user when no status filter is passed', async () => {
    stage([
      { userId: 'user-1', lemmaId: 'l1', status: 'known' },
      { userId: 'user-1', lemmaId: 'l2', status: 'learning' },
    ]);
    const rows = await listKnownLemmas('user-1');
    expect(rows).toHaveLength(2);
  });
});
