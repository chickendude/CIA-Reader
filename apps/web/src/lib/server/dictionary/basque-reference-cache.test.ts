// @vitest-environment node
/**
 * Unit tests for the DB-backed reference cache. The db module is mocked so
 * these run without a database; the key guarantee is graceful degradation —
 * a read error is a miss, a write error is swallowed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let selectResult: unknown[] = [];
let selectThrows = false;
let insertThrows = false;
const insertValues: unknown[] = [];

vi.mock('$lib/server/db/index.js', () => {
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: () => {
      if (selectThrows) throw new Error('table missing');
      return selectResult;
    },
  };
  const insertChain = {
    values: (v: unknown) => {
      insertValues.push(v);
      return insertChain;
    },
    onConflictDoUpdate: () => {
      if (insertThrows) throw new Error('write failed');
      return Promise.resolve();
    },
  };
  return {
    db: { select: () => selectChain, insert: () => insertChain },
    schema: { basqueReferenceCache: { word: 'word', source: 'source' } },
  };
});

import { dbReferenceCache } from './basque-reference-cache.js';
import type { BasqueReferenceResult } from './basque-reference.js';

const SAMPLE: BasqueReferenceResult[] = [
  {
    source: 'elhuyar_es',
    label: 'Elhuyar eu-es',
    headword: 'etxe',
    pos: 'iz.',
    definition: 'casa',
    examples: [],
    url: 'https://hiztegiak.elhuyar.eus/eu/etxe',
  },
];

beforeEach(() => {
  selectResult = [];
  selectThrows = false;
  insertThrows = false;
  insertValues.length = 0;
});

afterEach(() => vi.restoreAllMocks());

describe('dbReferenceCache.get', () => {
  it('returns the parsed entry with fetchedAt as epoch ms', async () => {
    selectResult = [{ results: SAMPLE, fetchedAt: new Date(1000) }];
    const entry = await dbReferenceCache.get('etxe', 'elhuyar_es');
    expect(entry).toEqual({ results: SAMPLE, fetchedAt: 1000 });
  });

  it('returns null on a cache miss', async () => {
    selectResult = [];
    expect(await dbReferenceCache.get('etxe', 'elhuyar_es')).toBeNull();
  });

  it('degrades to a miss when the query throws (e.g. table missing)', async () => {
    selectThrows = true;
    expect(await dbReferenceCache.get('etxe', 'elhuyar_es')).toBeNull();
  });
});

describe('dbReferenceCache.set', () => {
  it('upserts the (word, source) row with the results + timestamp', async () => {
    await dbReferenceCache.set('etxe', 'elhuyar_es', SAMPLE, 5000);
    expect(insertValues).toHaveLength(1);
    expect(insertValues[0]).toMatchObject({
      word: 'etxe',
      source: 'elhuyar_es',
      results: SAMPLE,
    });
    expect((insertValues[0] as { fetchedAt: Date }).fetchedAt.getTime()).toBe(5000);
  });

  it('swallows write errors (best-effort cache)', async () => {
    insertThrows = true;
    await expect(
      dbReferenceCache.set('etxe', 'elhuyar_es', SAMPLE, 5000),
    ).resolves.toBeUndefined();
  });
});
