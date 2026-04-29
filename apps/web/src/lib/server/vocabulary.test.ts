// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queryRows = vi.fn();

vi.mock('./db/index.js', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => queryRows()),
          })),
        })),
      })),
    })),
  },
  schema: {
    lemmas: {
      id: 'lemmas.id',
      language: 'lemmas.language',
      headword: 'lemmas.headword',
      pos: 'lemmas.pos',
      glossDefault: 'lemmas.gloss_default',
    },
    userKnownLemmas: {
      userId: 'user_known_lemmas.user_id',
      lemmaId: 'user_known_lemmas.lemma_id',
      status: 'user_known_lemmas.status',
    },
  },
}));

const { csvEscape, getVocabularyForExport, rowsToCsv } = await import(
  './vocabulary.js'
);

beforeEach(() => {
  queryRows.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('vocabulary export', () => {
  it('maps touched lemmas to CSV-shaped rows', async () => {
    queryRows.mockResolvedValueOnce([
      {
        headword: 'बोलना',
        pos: 'VERB',
        glossDefault: 'to speak',
        status: 'known',
      },
      {
        headword: 'घर',
        pos: 'NOUN',
        glossDefault: null,
        status: 'learning',
      },
    ]);

    await expect(getVocabularyForExport('u1', 'hi')).resolves.toEqual([
      {
        headword: 'बोलना',
        pos: 'VERB',
        gloss: 'to speak',
        status: 'known',
      },
      {
        headword: 'घर',
        pos: 'NOUN',
        gloss: '',
        status: 'learning',
      },
    ]);
  });

  it('escapes CSV cells with quotes, commas, and newlines', () => {
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('line\nbreak')).toBe('"line\nbreak"');
  });

  it('serializes the required header and status values', () => {
    const csv = rowsToCsv([
      {
        headword: 'a,b',
        pos: 'NOUN',
        gloss: 'letter "a"',
        status: 'ignored',
      },
    ]);

    expect(csv).toBe(
      'headword,pos,gloss,status\n"a,b",NOUN,"letter ""a""",ignored\n',
    );
  });
});
