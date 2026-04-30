// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// T-14.6: vocabulary export now joins both `userKnownLemmas` and
// `userKnownPhrases`. Each test stages two separate query results
// — first the lemma rows, then the phrase rows — and the mocked
// drizzle chain returns them in order.
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
    phrases: {
      id: 'phrases.id',
      language: 'phrases.language',
      surfaceNormalised: 'phrases.surface_normalised',
      pos: 'phrases.pos',
      glossDefault: 'phrases.gloss_default',
    },
    userKnownPhrases: {
      userId: 'user_known_phrases.user_id',
      phraseId: 'user_known_phrases.phrase_id',
      status: 'user_known_phrases.status',
    },
  },
}));

const { csvEscape, getVocabularyForExport, rowsToCsv } = await import(
  './vocabulary.js'
);

beforeEach(() => {
  queryRows.mockReset();
  // Default: empty phrase list. Per-test overrides stage richer
  // data via `mockResolvedValueOnce` before each call.
  queryRows.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('vocabulary export', () => {
  it('maps touched lemmas + phrases to CSV-shaped rows (T-14.6)', async () => {
    // First query: lemma rows.
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
    // Second query: phrase rows.
    queryRows.mockResolvedValueOnce([
      {
        surfaceNormalised: 'इंतज़ार करना',
        pos: 'VERB',
        glossDefault: 'to wait',
        status: 'known',
      },
      {
        surfaceNormalised: 'के बारे में',
        pos: null,
        glossDefault: null,
        status: 'learning',
      },
    ]);

    await expect(getVocabularyForExport('u1', 'hi')).resolves.toEqual([
      { kind: 'lemma', headword: 'बोलना', pos: 'VERB', gloss: 'to speak', status: 'known' },
      { kind: 'lemma', headword: 'घर', pos: 'NOUN', gloss: '', status: 'learning' },
      {
        kind: 'phrase',
        headword: 'इंतज़ार करना',
        pos: 'VERB',
        gloss: 'to wait',
        status: 'known',
      },
      {
        kind: 'phrase',
        headword: 'के बारे में',
        pos: '',
        gloss: '',
        status: 'learning',
      },
    ]);
  });

  it('returns lemma-only output when the user has no known phrases (T-14.6)', async () => {
    queryRows.mockResolvedValueOnce([
      {
        headword: 'बोलना',
        pos: 'VERB',
        glossDefault: 'to speak',
        status: 'known',
      },
    ]);
    queryRows.mockResolvedValueOnce([]);
    await expect(getVocabularyForExport('u1', 'hi')).resolves.toEqual([
      {
        kind: 'lemma',
        headword: 'बोलना',
        pos: 'VERB',
        gloss: 'to speak',
        status: 'known',
      },
    ]);
  });

  it('escapes CSV cells with quotes, commas, and newlines', () => {
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('line\nbreak')).toBe('"line\nbreak"');
  });

  it('serializes the required header and status values (T-14.6 adds the kind column)', () => {
    const csv = rowsToCsv([
      {
        kind: 'lemma',
        headword: 'a,b',
        pos: 'NOUN',
        gloss: 'letter "a"',
        status: 'ignored',
      },
      {
        kind: 'phrase',
        headword: 'इंतज़ार करना',
        pos: 'VERB',
        gloss: 'to wait',
        status: 'known',
      },
    ]);

    expect(csv).toBe(
      'kind,headword,pos,gloss,status\n' +
        'lemma,"a,b",NOUN,"letter ""a""",ignored\n' +
        'phrase,इंतज़ार करना,VERB,to wait,known\n',
    );
  });
});
