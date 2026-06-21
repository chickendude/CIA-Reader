// @vitest-environment node
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
    schema: {
      sentenceTranslations: {
        language: 'l',
        targetLanguage: 'tl',
        model: 'm',
        textHash: 'h',
        translation: 'tr',
      },
    },
  };
});

import {
  getCachedTranslation,
  hashSentence,
  setCachedTranslation,
} from './sentence-translation-cache.js';

const KEY = { language: 'eu', targetLanguage: 'en', model: 'gpt-4o', textHash: 'abc' };

beforeEach(() => {
  selectResult = [];
  selectThrows = false;
  insertThrows = false;
  insertValues.length = 0;
});
afterEach(() => vi.restoreAllMocks());

describe('hashSentence', () => {
  it('is stable and input-sensitive', () => {
    expect(hashSentence('Etxe bat.')).toBe(hashSentence('Etxe bat.'));
    expect(hashSentence('a')).not.toBe(hashSentence('b'));
  });
});

describe('getCachedTranslation', () => {
  it('returns the translation on a hit', async () => {
    selectResult = [{ translation: 'A house.' }];
    expect(await getCachedTranslation(KEY)).toBe('A house.');
  });
  it('returns null on a miss', async () => {
    expect(await getCachedTranslation(KEY)).toBeNull();
  });
  it('degrades to null when the query throws', async () => {
    selectThrows = true;
    expect(await getCachedTranslation(KEY)).toBeNull();
  });
});

describe('setCachedTranslation', () => {
  it('upserts the row with key + text + translation', async () => {
    await setCachedTranslation(KEY, 'Etxe bat.', 'A house.');
    expect(insertValues[0]).toMatchObject({ ...KEY, text: 'Etxe bat.', translation: 'A house.' });
  });
  it('swallows write errors', async () => {
    insertThrows = true;
    await expect(setCachedTranslation(KEY, 'x', 'y')).resolves.toBeUndefined();
  });
});
