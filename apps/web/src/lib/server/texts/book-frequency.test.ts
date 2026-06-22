// @vitest-environment node
/**
 * Unit tests for book-wide lemma frequency. The db is mocked with a
 * thenable query-chain whose every awaited query dequeues the next staged
 * result, so we assert the query *sequence* and the composed counts without a
 * real database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let queue: unknown[][] = [];

vi.mock('$lib/server/db/index.js', () => {
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'groupBy', 'limit', 'innerJoin', 'orderBy']) {
    chain[m] = () => chain;
  }
  // Awaiting the chain (at any point) resolves the next staged rows.
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    resolve(queue.shift() ?? []);
  return {
    db: { select: () => chain },
    schema: {
      textChapters: { id: 'tc.id', textId: 'tc.text_id' },
      collectionItems: { textId: 'ci.text_id', collectionId: 'ci.collection_id' },
      textTokens: { chapterId: 'tt.chapter_id', lemmaId: 'tt.lemma_id' },
      lemmas: { id: 'l.id', headword: 'l.headword', language: 'l.language' },
    },
  };
});

import { lemmaBookFrequency, resolveBookChapterScope } from './book-frequency.js';

beforeEach(() => {
  queue = [];
});
afterEach(() => vi.restoreAllMocks());

describe('resolveBookChapterScope', () => {
  it('expands to all sibling texts when the text is in a collection', async () => {
    queue = [
      [{ id: 'c1' }, { id: 'c2' }], // own chapters
      [{ collectionId: 'col-1' }], // collection item lookup
      [{ textId: 't1' }, { textId: 't2' }], // sibling texts
      [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }], // all book chapters
    ];
    const scope = await resolveBookChapterScope('t1');
    expect(scope.textChapterIds).toEqual(['c1', 'c2']);
    expect(scope.bookChapterIds).toEqual(['c1', 'c2', 'c3']);
  });

  it('falls back to the single text when it is not in a collection', async () => {
    queue = [
      [{ id: 'c1' }, { id: 'c2' }], // own chapters
      [], // no collection item
    ];
    const scope = await resolveBookChapterScope('t1');
    expect(scope.textChapterIds).toEqual(['c1', 'c2']);
    expect(scope.bookChapterIds).toEqual(['c1', 'c2']);
  });
});

describe('lemmaBookFrequency', () => {
  it('counts by headword across book + text (rolls up duplicate lemma rows)', async () => {
    queue = [
      [{ headword: 'afrika', language: 'eu' }], // resolve the clicked lemma's word
      [{ id: 'c1' }, { id: 'c2' }], // own chapters
      [{ collectionId: 'col-1' }], // collection item
      [{ textId: 't1' }, { textId: 't2' }], // siblings
      [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }], // book chapters
      [{ n: 7 }], // headword count over book chapters
      [{ n: 3 }], // headword count over text chapters
    ];
    const out = await lemmaBookFrequency('t1', 'lem-1');
    expect(out).toEqual({ book: 7, text: 3 });
  });

  it('reports zero without counting when there are no chapters', async () => {
    queue = [
      [{ headword: 'afrika', language: 'eu' }], // lemma resolves
      [], // own chapters (none)
      [], // no collection item
      // no count queries are issued because chapter lists are empty
    ];
    const out = await lemmaBookFrequency('t1', 'lem-1');
    expect(out).toEqual({ book: 0, text: 0 });
  });

  it('reports zero when the lemma id is unknown', async () => {
    queue = [
      [], // lemma lookup finds nothing
    ];
    const out = await lemmaBookFrequency('t1', 'missing');
    expect(out).toEqual({ book: 0, text: 0 });
  });
});
