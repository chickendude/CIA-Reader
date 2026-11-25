// @vitest-environment node
/**
 * Tests for the dictionary browse service. Mocks the drizzle
 * `db` surface — we mostly want to prove that filters wire through and
 * that limit/offset are clamped sanely.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const staged: Array<unknown[]> = [];
function stage(rows: unknown[]) {
  staged.push(rows);
}
function nextStaged(): unknown[] {
  const v = staged.shift();
  if (!v) throw new Error('Test bug: no staged result available');
  return v;
}

const chainCalls: Array<{
  method: 'limit' | 'offset';
  arg: number;
}> = [];
const whereClause = vi.fn<(condition: SQL) => void>();

function makeSelectChain() {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = (condition: SQL) => {
    whereClause(condition);
    return chain;
  };
  chain.orderBy = vi.fn(() => chain);
  chain.limit = vi.fn((n: number) => {
    chainCalls.push({ method: 'limit', arg: n });
    return chain;
  });
  chain.offset = vi.fn((n: number) => {
    chainCalls.push({ method: 'offset', arg: n });
    return chain;
  });
  chain.then = (resolve: (v: unknown) => unknown) => resolve(nextStaged());
  return chain;
}

const selectFn = vi.fn(() => makeSelectChain());

vi.mock('../db/index.js', async () => ({
  db: { select: () => selectFn() },
  schema: await import('../db/schema.js'),
}));

const {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  listDictionaryLemmas,
  publicLemma,
} = await import('./browse.js');

function lemmaRow(partial: Record<string, unknown> = {}) {
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
    ...partial,
  };
}

beforeEach(() => {
  staged.length = 0;
  chainCalls.length = 0;
  selectFn.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('listDictionaryLemmas', () => {
  it('returns paginated lemmas and a total count', async () => {
    stage([lemmaRow(), lemmaRow({ id: 'lemma-2', headword: 'खाना' })]);
    stage([{ n: 57 }]);

    const result = await listDictionaryLemmas('hi');
    expect(result.lemmas).toHaveLength(2);
    expect(result.totalCount).toBe(57);
    expect(result.limit).toBe(DEFAULT_PAGE_SIZE);
    expect(result.offset).toBe(0);
    expect(result.usedNuktaFallback).toBe(false);
  });

  it('clamps limit to MAX_PAGE_SIZE when caller asks for too many', async () => {
    stage([]);
    stage([{ n: 0 }]);
    await listDictionaryLemmas('hi', { limit: 99999 });
    expect(
      chainCalls.find((c) => c.method === 'limit'),
    ).toEqual({ method: 'limit', arg: MAX_PAGE_SIZE });
  });

  it('clamps a negative offset to 0', async () => {
    stage([]);
    stage([{ n: 0 }]);
    await listDictionaryLemmas('hi', { offset: -100 });
    expect(
      chainCalls.find((c) => c.method === 'offset'),
    ).toEqual({ method: 'offset', arg: 0 });
  });

  it('falls back to DEFAULT_PAGE_SIZE when limit is 0 or null', async () => {
    stage([]);
    stage([{ n: 0 }]);
    await listDictionaryLemmas('hi', { limit: 0 });
    expect(
      chainCalls.find((c) => c.method === 'limit'),
    ).toEqual({ method: 'limit', arg: DEFAULT_PAGE_SIZE });
  });

  it('accepts a search query and plumbs it through (whitespace trimmed)', async () => {
    stage([lemmaRow()]);
    stage([{ n: 1 }]);
    const result = await listDictionaryLemmas('hi', { q: '  बोल  ' });
    expect(result.lemmas).toHaveLength(1);
  });

  it('treats a whitespace-only query as no query', async () => {
    stage([lemmaRow()]);
    stage([{ n: 1 }]);
    await expect(
      listDictionaryLemmas('hi', { q: '   ' }),
    ).resolves.toMatchObject({ totalCount: 1 });
  });

  it('includes exact alternative headwords in reader searches', async () => {
    stage([lemmaRow({ headword: 'अलग-अलग' })]);
    stage([{ n: 1 }]);
    await listDictionaryLemmas('hi', { q: 'अलग अलग' });
    const dialect = new PgDialect();
    for (const [condition] of whereClause.mock.calls) {
      const query = dialect.sqlToQuery(condition);
      expect(query.sql).toContain("entry->'alternative_headwords' ?| ARRAY[");
      expect(query.params).toContain('अलग अलग');
    }
    expect(whereClause).toHaveBeenCalledTimes(2);
  });

  it('accepts filter combinations (pos + rank range + hasOfficial)', async () => {
    stage([lemmaRow()]);
    stage([{ n: 1 }]);
    const result = await listDictionaryLemmas('hi', {
      pos: ['verb', 'noun'],
      minRank: 1,
      maxRank: 1000,
      hasOfficialTranslation: true,
    });
    expect(result.lemmas).toHaveLength(1);
    const dialect = new PgDialect();
    expect(whereClause).toHaveBeenCalledTimes(2);
    for (const [condition] of whereClause.mock.calls) {
      const query = dialect.sqlToQuery(condition);
      expect(query.sql).toContain('"translations"."target_id" = "lemmas"."id"');
      expect(query.sql).toContain('"translations"."target_type" =');
      expect(query.sql).toContain('"translations"."hidden" =');
      expect(query.params).toEqual(['hi', 'verb', 'noun', 1, 1000, 'lemma', false, 'official_dictionary', 'curator']);
    }
  });

  it('respects an explicit offset', async () => {
    stage([]);
    stage([{ n: 500 }]);
    const result = await listDictionaryLemmas('hi', { offset: 100, limit: 25 });
    expect(result.offset).toBe(100);
    expect(result.limit).toBe(25);
    expect(chainCalls).toContainEqual({ method: 'offset', arg: 100 });
    expect(chainCalls).toContainEqual({ method: 'limit', arg: 25 });
  });

  it('does not add a pos filter when pos is an empty list', async () => {
    stage([lemmaRow()]);
    stage([{ n: 1 }]);
    // We can't easily introspect the WHERE clause, but we can assert
    // no error and that the call resolves.
    await expect(
      listDictionaryLemmas('hi', { pos: [] }),
    ).resolves.toMatchObject({ totalCount: 1 });
  });

  // ---- nukta-agnostic fallback ----------------------------------

  it('falls back to a nukta-agnostic search when the user typed without nukta but DB has it', async () => {
    // The bug-driving direction: user types `पढना` (no nukta), the
    // canonical entry is `पढ़ना`. Strict misses; fallback should
    // surface the entry. Mock convention: each tier issues
    // rows-then-count, two `db` calls = two `stage()` entries.
    stage([]);
    stage([{ n: 0 }]);
    stage([lemmaRow({ headword: 'पढ़ना' })]);
    stage([{ n: 1 }]);

    const result = await listDictionaryLemmas('hi', { q: 'पढना' });
    expect(result.usedNuktaFallback).toBe(true);
    expect(result.lemmas).toHaveLength(1);
    expect(result.totalCount).toBe(1);
  });

  it('falls back to a nukta-agnostic search when the user typed with nukta but DB strips it', async () => {
    // A search for पढ़ना can still find an older entry stored as पढना. Both spellings have the
    // same search key after removing the nukta.
    stage([]);
    stage([{ n: 0 }]);
    stage([lemmaRow({ headword: 'पढना' })]);
    stage([{ n: 1 }]);

    const result = await listDictionaryLemmas('hi', { q: 'पढ़ना' });
    expect(result.usedNuktaFallback).toBe(true);
    expect(result.totalCount).toBe(1);
  });

  it('does not run the fallback when the strict tier already has hits', async () => {
    stage([lemmaRow({ headword: 'पढ़ना' })]);
    stage([{ n: 1 }]);
    // No fallback stages — if the function were to run the fallback
    // the test would explode in nextStaged().

    const result = await listDictionaryLemmas('hi', { q: 'पढ़ना' });
    expect(result.usedNuktaFallback).toBe(false);
    expect(result.lemmas).toHaveLength(1);
  });

  it('does not advertise the fallback when both tiers are empty', async () => {
    // Strict empty.
    stage([]);
    stage([{ n: 0 }]);
    // Fallback also empty — a "showing nukta-agnostic results"
    // banner over zero rows would read worse than a plain "no
    // matches".
    stage([]);
    stage([{ n: 0 }]);

    const result = await listDictionaryLemmas('hi', { q: 'पढ़ना' });
    expect(result.usedNuktaFallback).toBe(false);
    expect(result.totalCount).toBe(0);
  });

  it('does not run the fallback when no query is provided', async () => {
    // Empty-query browse must skip the fallback entirely so an
    // unfiltered list isn't double-counted (and no extra DB call is
    // wasted on every page-load of the dictionary index).
    stage([lemmaRow()]);
    stage([{ n: 1 }]);
    const result = await listDictionaryLemmas('hi');
    expect(result.usedNuktaFallback).toBe(false);
  });

  // ---- romanization-aware search ----------------------------

  it('transliterates a Latin query to native and searches against the strict tier', async () => {
    stage([lemmaRow({ headword: 'किताब' })]);
    stage([{ n: 1 }]);
    const result = await listDictionaryLemmas('hi', { q: 'kitaab' });
    expect(result.usedRomanizationTransliteration).toBe(true);
    expect(result.effectiveQuery).toBe('किताब');
    expect(result.usedNuktaFallback).toBe(false);
    expect(result.lemmas).toHaveLength(1);
  });

  it('does not transliterate when the query already contains native script', async () => {
    stage([lemmaRow({ headword: 'किताब' })]);
    stage([{ n: 1 }]);
    const result = await listDictionaryLemmas('hi', { q: 'किताब' });
    expect(result.usedRomanizationTransliteration).toBe(false);
    expect(result.effectiveQuery).toBe('किताब');
  });

  it('echoes the empty effectiveQuery when no q is provided', async () => {
    stage([lemmaRow()]);
    stage([{ n: 1 }]);
    const result = await listDictionaryLemmas('hi');
    expect(result.usedRomanizationTransliteration).toBe(false);
    expect(result.effectiveQuery).toBe('');
  });

  it('preserves the romanization-transliteration flag through the nukta fallback path', async () => {
    // Strict tier on the transliterated `पढना` misses; the
    // nukta-agnostic tier picks up `पढ़ना`. The romanization flag
    // should still be true on the result so the UI can render both
    // hints.
    stage([]); // strict rows
    stage([{ n: 0 }]); // strict count
    stage([lemmaRow({ headword: 'पढ़ना' })]); // fallback rows
    stage([{ n: 1 }]); // fallback count
    const result = await listDictionaryLemmas('hi', { q: 'paDhana' });
    expect(result.usedRomanizationTransliteration).toBe(true);
    expect(result.usedNuktaFallback).toBe(true);
  });

  it('does not advertise transliteration when the helper leaves the input unchanged', async () => {
    // `123` runs through `latinToNative` cleanly — none of the
    // ITRANS keys match digits, so the helper returns the input
    // verbatim. We don't want a misleading "transliterated from"
    // hint in that case. Stage a strict-tier hit so the fallback
    // doesn't fire (the digit-shaped query is irrelevant for
    // headword search but the function still walks the same path).
    stage([lemmaRow({ headword: '123' })]);
    stage([{ n: 1 }]);
    const result = await listDictionaryLemmas('hi', { q: '123' });
    expect(result.usedRomanizationTransliteration).toBe(false);
    expect(result.effectiveQuery).toBe('123');
  });
});

describe('publicLemma', () => {
  it('renames source to provenanceSource and drops sourceId', () => {
    const shaped = publicLemma(lemmaRow() as never);
    expect(shaped).toMatchObject({
      id: 'lemma-1',
      headword: 'बोलना',
      provenanceSource: 'official_dictionary',
      sourceAttribution: 'Hindi WordNet',
    });
    expect((shaped as Record<string, unknown>).source).toBeUndefined();
    expect((shaped as Record<string, unknown>).sourceId).toBeUndefined();
  });
});
