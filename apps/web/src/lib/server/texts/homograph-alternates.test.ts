// @vitest-environment node
//
// Curated-homograph "alternate lemma" samples (feat/basque-homograph-alternates).
//
// When a `form_lemma_overrides` row carries ordered `alternate_lemma_ids`, the
// dispatcher must append those alternates to the token's `lemmaCandidates` after
// the chosen default (descending score preserves the curator's order). The reader
// then renders them as pickable parse tabs (tokens.ts drops the active lemma and
// flips `isAmbiguous` when candidates exist — covered by its own tests).
//
// This drives `persistTokens` directly with a hand-built LemmaIndex, so each
// sample is a pure "override + alternates in → persisted candidates out" check,
// no NLP service or DB needed.
import { describe, expect, it, vi } from 'vitest';

import type { LemmaIndex } from './in-process-dispatcher.js';
import type { NlpToken } from '../nlp-client.js';

// Capture the token rows persistTokens would INSERT; stub the phrase hooks it
// calls after writing (each covered by its own suite).
const insertedRows: unknown[] = [];
vi.mock('../db/index.js', () => ({
  db: {
    delete: () => ({ where: () => Promise.resolve(undefined) }),
    insert: () => ({
      values: (rows: unknown[]) => {
        insertedRows.push(...rows);
        return Promise.resolve(undefined);
      },
    }),
  },
  schema: {
    textTokens: { id: 'text_tokens.id', chapterId: 'text_tokens.chapter_id' },
  },
}));
vi.mock('./phrase-spans.js', () => ({
  rebuildChapterSpans: vi.fn().mockResolvedValue(0),
}));
vi.mock('./phrase-proposals.js', () => ({
  upsertPhraseProposals: vi.fn().mockResolvedValue(0),
}));

const { persistTokens } = await import('./in-process-dispatcher.js');

type Sample = {
  /** vitest interpolates `$name` into the test title. */
  name: string;
  /** Lower-case NFC surface (foldSurface is NFC + lower-case, so it's identity). */
  surface: string;
  /** The override's chosen default lemma id (the token's active lemma). */
  chosen: string;
  /** Ordered alternate lemma ids, most- to least-likely. */
  alternates: string[];
};

// Real Basque homographs the schema comment calls out, plus a three-sense case
// (to prove ordering) and a no-alternate control (to prove the common path is
// untouched).
const SAMPLES: Sample[] = [
  {
    name: 'galera → galera (loss) + gale (hunger)',
    surface: 'galera',
    chosen: 'lemma-galera',
    alternates: ['lemma-gale'],
  },
  {
    name: 'ilaran → ilara (queue) + ilar (bean)',
    surface: 'ilaran',
    chosen: 'lemma-ilara',
    alternates: ['lemma-ilar'],
  },
  {
    name: 'three senses keep the curator order',
    surface: 'ordena',
    chosen: 'lemma-ordena-order',
    alternates: ['lemma-ordena-command', 'lemma-ordena-religious'],
  },
  {
    name: 'no alternates → single candidate, unchanged',
    surface: 'etxe',
    chosen: 'lemma-etxe',
    alternates: [],
  },
];

function emptyIndex(): LemmaIndex {
  return {
    byHeadwordPos: new Map(),
    byHeadword: new Map(),
    byNuktaStrippedHeadword: new Map(),
    overridesBySurface: new Map(),
    overrideAlternatesBySurface: new Map(),
    bySurface: new Map(),
    romanizationBySurface: new Map(),
  };
}

function indexFor(s: Sample): LemmaIndex {
  const index = emptyIndex();
  index.overridesBySurface.set(s.surface, s.chosen);
  if (s.alternates.length > 0) {
    index.overrideAlternatesBySurface.set(s.surface, s.alternates);
  }
  return index;
}

// A one-token NLP result: Stanza's guess (`lemma === surface`) that the override
// out-ranks. Kept minimal — only the fields persistTokens reads.
function nlpToken(surface: string): NlpToken {
  return {
    idx: 0,
    surface,
    is_word: true,
    is_ambiguous: false,
    is_oov: false,
    romanization: null,
    number_forms: null,
    candidates: [{ lemma: surface, pos: 'NOUN', score: 1, features: {} }],
  };
}

describe('curated homograph alternates → pickable candidate tabs', () => {
  it.each(SAMPLES)('$name', async (s) => {
    insertedRows.length = 0;
    await persistTokens({
      chapterId: 'chap-1',
      language: 'eu',
      index: indexFor(s),
      tokens: [nlpToken(s.surface)],
    });

    expect(insertedRows).toHaveLength(1);
    const row = insertedRows[0] as {
      lemmaId: string | null;
      lemmaCandidates: Array<{ lemmaId: string | null; features: unknown; score: number }>;
    };

    // The override's chosen lemma is the token's active lemma.
    expect(row.lemmaId).toBe(s.chosen);

    // Chosen default first (score 1), then each alternate just below it in the
    // curator's order (strictly descending score). Empty features — an alternate
    // is a different lemma, not this token's parsed morphology.
    expect(row.lemmaCandidates).toEqual([
      { lemmaId: s.chosen, features: {}, score: 1 },
      ...s.alternates.map((id, j) => ({
        lemmaId: id,
        features: {},
        score: 1 - (j + 1) / 1000,
      })),
    ]);
    // Sanity: candidate scores stay strictly descending (default then alternates).
    const scores = row.lemmaCandidates.map((c) => c.score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]!).toBeLessThan(scores[i - 1]!);
    }
  });
});
