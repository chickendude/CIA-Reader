// @vitest-environment node
/**
 * DB-mocked unit tests for `getLemmaTranslations` — specifically the
 * sibling-fallback path added in T-3.14.
 *
 * The pure `bucketTranslations` sorter has its own tests in
 * `lookups.test.ts`; this file covers the wiring around DB calls plus
 * the sibling-fetch logic that kicks in when the directly-linked lemma
 * has no translations of its own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const staged: Array<unknown[] | { rows: unknown[] }> = [];
function stage(rows: unknown[] | { rows: unknown[] }) {
  staged.push(rows);
}
function nextStaged(): unknown[] | { rows: unknown[] } {
  const v = staged.shift();
  if (!v) throw new Error('Test bug: no staged result available');
  return v;
}

function makeSelectChain() {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) => resolve(nextStaged());
  return chain;
}

const selectFn = vi.fn(() => makeSelectChain());
const executeFn = vi.fn((query?: unknown) => {
  void query;
  return nextStaged();
});

vi.mock('../db/index.js', () => ({
  db: {
    select: () => selectFn(),
    execute: (query: unknown) => executeFn(query),
  },
  schema: {
    lemmas: {
      id: 'lemmas.id',
      language: 'lemmas.language',
      headword: 'lemmas.headword',
      headwordNuktaStripped: 'lemmas.headword_nukta_stripped',
    },
    translations: {
      id: 'translations.id',
      lemmaId: 'translations.lemma_id',
    },
    translationVotes: {
      userId: 'translation_votes.user_id',
      translationId: 'translation_votes.translation_id',
      value: 'translation_votes.value',
    },
  },
}));

const { getLemmaTranslations, LemmaNotFoundError } = await import('./lookups.js');

function lemmaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lemma-1',
    language: 'hi',
    headword: 'पार्क',
    pos: 'PROPN',
    script: 'Deva',
    glossDefault: null,
    frequencyRank: null,
    source: 'official_dictionary',
    sourceAttribution: null,
    sourceId: null,
    curatorLocked: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function translationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tr-1',
    lemmaId: 'lemma-2',
    source: 'official_dictionary',
    submittedBy: null,
    parentTranslationId: null,
    body: 'park',
    targetLanguage: 'en',
    sourceAttribution: 'Wiktionary Hindi via Kaikki.org',
    sourceId: 'kaikki:hi:पार्क:NOUN:abc123abc123',
    hidden: false,
    displayRank: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  staged.length = 0;
  selectFn.mockClear();
  executeFn.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('getLemmaTranslations (T-3.14 sibling fallback)', () => {
  it('throws LemmaNotFoundError when the primary lemma is missing', async () => {
    stage([]); // SELECT lemma → none
    await expect(getLemmaTranslations('missing', null)).rejects.toBeInstanceOf(
      LemmaNotFoundError,
    );
  });

  it('returns primary translations directly when the linked lemma has any', async () => {
    stage([lemmaRow({ pos: 'NOUN' })]); // SELECT lemma
    stage([translationRow({ lemmaId: 'lemma-1', body: 'park' })]); // primary translations
    const out = await getLemmaTranslations('lemma-1', null);
    expect(out.lemma.id).toBe('lemma-1');
    expect(out.lemma.pos).toBe('NOUN');
    expect(out.translations.official.map((t) => t.body)).toEqual(['park']);
    // Only two SELECT calls — no fallback fetch needed.
    expect(selectFn).toHaveBeenCalledTimes(2);
  });

  it('falls back to sibling lemmas when the primary has zero translations', async () => {
    // Common case: a token tagged PROPN inside a multi-word proper noun
    // ("ग्लेशियर नेशनल पार्क") with no PROPN gloss, but a sibling NOUN
    // lemma carries the actual dictionary entry from Kaikki.
    stage([lemmaRow({ id: 'lemma-1', pos: 'PROPN' })]); // SELECT lemma
    stage([]); // primary translations → none
    stage([
      // sibling join result: rows shaped as { translation: <row> }
      { translation: translationRow({ lemmaId: 'lemma-2', body: 'park' }) },
      { translation: translationRow({ id: 'tr-2', lemmaId: 'lemma-2', body: 'garden' }) },
    ]);
    const out = await getLemmaTranslations('lemma-1', null);
    // Lemma metadata stays the primary's — the user clicked PROPN, we
    // just borrowed text from the NOUN sibling, we shouldn't lie about
    // what was clicked.
    expect(out.lemma.pos).toBe('PROPN');
    // Translations come from the sibling, bucketed via the existing rules.
    expect(out.translations.official.map((t) => t.body).sort()).toEqual([
      'garden',
      'park',
    ]);
    expect(selectFn).toHaveBeenCalledTimes(3);
  });

  it('still returns empty when neither the primary nor any sibling tier has translations', async () => {
    stage([lemmaRow()]);
    stage([]); // primary empty
    stage([]); // exact-headword sibling join empty
    stage([]); // #318: nukta-stripped sibling join empty
    const out = await getLemmaTranslations('lemma-1', null);
    expect(out.translations.personal).toEqual([]);
    expect(out.translations.official).toEqual([]);
    expect(out.translations.community).toEqual([]);
  });

  it('falls back to nukta-stripped siblings when exact-headword siblings are empty (#318)', async () => {
    // Linked lemma is `पढना` (pre-#316, no nukta). Exact-headword
    // sibling fetch finds nothing (no other `पढना` rows). The
    // canonical entry sits under `पढ़ना` (with nukta) and ships the
    // gloss — caught by the nukta-stripped tier because both reduce
    // to the same key.
    stage([lemmaRow({ id: 'lemma-1', headword: 'पढना', pos: 'VERB' })]);
    stage([]); // primary translations empty
    stage([]); // exact-headword sibling fetch empty
    stage([
      // nukta-stripped sibling fetch finds the canonical `पढ़ना` row
      {
        translation: translationRow({
          lemmaId: 'lemma-canonical',
          body: 'to read',
        }),
      },
    ]);
    const out = await getLemmaTranslations('lemma-1', null);
    // We honor the user-clicked lemma's metadata; only the
    // translation text comes from the canonical sibling.
    expect(out.lemma.id).toBe('lemma-1');
    expect(out.lemma.headword).toBe('पढना');
    expect(out.translations.official.map((t) => t.body)).toEqual(['to read']);
    expect(selectFn).toHaveBeenCalledTimes(4);
  });

  it('honors the viewer when bucketing sibling translations into personal vs community', async () => {
    stage([lemmaRow()]);
    stage([]); // primary empty
    stage([
      // viewer's own user submission attached to a sibling
      {
        translation: translationRow({
          lemmaId: 'lemma-2',
          source: 'user',
          submittedBy: 'u1',
          body: 'my fork',
          sourceAttribution: null,
          sourceId: null,
        }),
      },
    ]);
    stage({ rows: [] }); // vote score lookup
    stage([]); // viewer vote lookup
    const out = await getLemmaTranslations('lemma-1', { id: 'u1', role: 'user' });
    expect(out.translations.personal.map((t) => t.body)).toEqual(['my fork']);
    expect(out.translations.community).toEqual([]);
  });
});
