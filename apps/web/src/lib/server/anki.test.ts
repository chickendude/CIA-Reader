// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let queue: unknown[][] = [];

vi.mock('$lib/server/db/index.js', () => {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'innerJoin', 'orderBy', 'limit', 'groupBy']) {
    chain[m] = () => chain;
  }
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    resolve(queue.shift() ?? []);
  return {
    db: chain,
    schema: {
      userKnownLemmas: {
        lemmaId: 'ukl.lemma_id',
        userId: 'ukl.user_id',
        status: 'ukl.status',
        minedSentence: 'ukl.mined_sentence',
      },
      lemmas: { id: 'l.id', headword: 'l.headword', pos: 'l.pos', glossDefault: 'l.gloss', language: 'l.language' },
      translations: {
        targetId: 'tr.target_id',
        targetType: 'tr.target_type',
        source: 'tr.source',
        submittedBy: 'tr.submitted_by',
        body: 'tr.body',
      },
      texts: { id: 't.id', language: 't.language' },
    },
  };
});

import { buildApkg, cardBackHtml, getAnkiCards, type AnkiCard } from './anki.js';

beforeEach(() => {
  queue = [];
});
afterEach(() => vi.restoreAllMocks());

describe('cardBackHtml', () => {
  it('renders definition + mined sentence + samples and escapes HTML', () => {
    const card: AnkiCard = {
      word: 'etxe',
      pos: 'NOUN',
      definition: 'house <home>',
      frequency: 3,
      minedSentence: 'Etxe bat.',
      samples: ['Etxe handia.', 'Etxe & lorategia.'],
    };
    const html = cardBackHtml(card);
    expect(html).toContain('house &lt;home&gt;');
    expect(html).toContain('Etxe bat.');
    expect(html).toContain('Etxe handia.');
    expect(html).toContain('Etxe &amp; lorategia.');
  });

  it('omits empty pieces', () => {
    const html = cardBackHtml({
      word: 'ur',
      pos: '',
      definition: '',
      frequency: 0,
      minedSentence: null,
      samples: [],
    });
    expect(html).toBe('');
  });
});

describe('getAnkiCards (language-wide path)', () => {
  it('builds cards, preferring the personal gloss over the default', async () => {
    queue = [
      // learning lemmas
      [
        {
          lemmaId: 'l1',
          headword: 'etxe',
          pos: 'NOUN',
          glossDefault: 'house',
          minedSentence: 'Etxe bat.',
        },
        {
          lemmaId: 'l2',
          headword: 'ur',
          pos: 'NOUN',
          glossDefault: 'water',
          minedSentence: null,
        },
      ],
      // personal glosses
      [{ lemmaId: 'l2', body: 'agua (my note)' }],
    ];
    const { language, cards } = await getAnkiCards('user-1', { language: 'eu' });
    expect(language).toBe('eu');
    expect(cards).toHaveLength(2);
    const etxe = cards.find((c) => c.word === 'etxe')!;
    expect(etxe.definition).toBe('house');
    expect(etxe.minedSentence).toBe('Etxe bat.');
    expect(etxe.frequency).toBe(0); // no textId → no book counts
    const ur = cards.find((c) => c.word === 'ur')!;
    expect(ur.definition).toBe('agua (my note)'); // personal gloss wins
  });
});

describe('buildApkg', () => {
  it('produces a non-empty .apkg zip (PK header)', async () => {
    const buf = await buildApkg('Test::Deck', [
      {
        word: 'etxe',
        pos: 'NOUN',
        definition: 'house',
        frequency: 1,
        minedSentence: 'Etxe bat.',
        samples: [],
      },
    ]);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.slice(0, 2).toString('latin1')).toBe('PK');
  });
});
