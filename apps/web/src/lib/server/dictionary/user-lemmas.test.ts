// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const staged: unknown[][] = [];
let insertValues: Record<string, unknown> | undefined;

vi.mock('drizzle-orm', () => ({
  and: (...a: unknown[]) => a,
  eq: (...a: unknown[]) => a,
}));

vi.mock('../db/index.js', () => {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(staged.shift() ?? []),
    insert: () => chain,
    values: (v: Record<string, unknown>) => {
      insertValues = v;
      return chain;
    },
    returning: () => Promise.resolve(staged.shift() ?? []),
  });
  return { db: chain, schema: { lemmas: {} } };
});

import { ensureUserLemma, UserLemmaError } from './user-lemmas';

beforeEach(() => {
  staged.length = 0;
  insertValues = undefined;
});
afterEach(() => vi.clearAllMocks());

describe('ensureUserLemma', () => {
  it('returns an existing lemma without inserting', async () => {
    staged.push([{ id: 'L1', headword: 'kaño', language: 'eu' }]);
    const row = await ensureUserLemma({ userId: 'u1', language: 'eu', headword: 'kaño' });
    expect(row).toMatchObject({ id: 'L1' });
    expect(insertValues).toBeUndefined();
  });

  it('inserts a source=user lemma when none exists', async () => {
    staged.push([]); // existence check → none
    staged.push([{ id: 'NEW', headword: 'kaño', language: 'eu', source: 'user' }]);
    const row = await ensureUserLemma({ userId: 'u1', language: 'eu', headword: '  kaño  ' });
    expect(row).toMatchObject({ id: 'NEW' });
    expect(insertValues).toMatchObject({
      language: 'eu',
      headword: 'kaño', // trimmed + NFC
      source: 'user',
      pos: 'X',
      script: 'Latn',
    });
  });

  it('rejects an empty headword', async () => {
    await expect(
      ensureUserLemma({ userId: 'u1', language: 'eu', headword: '   ' }),
    ).rejects.toBeInstanceOf(UserLemmaError);
  });
});
