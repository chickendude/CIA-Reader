// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import JSZip from 'jszip';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

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
  it('exports decks larger than the old 16 MB heap and keeps note identity through definition edits', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'anki-test-'));
    const inspect = async (buffer: Buffer) => {
      const zip = await JSZip.loadAsync(buffer);
      const path = join(directory, 'deck.sqlite');
      const bytes = await zip.file('collection.anki2')!.async('nodebuffer');
      await writeFile(path, bytes);
      const sqlite = new DatabaseSync(path, { readOnly: true });
      try {
        return { bytes: bytes.length, notes: sqlite.prepare('SELECT guid,mid FROM notes ORDER BY id').all(),
          integrity: sqlite.prepare('PRAGMA integrity_check').get()?.integrity_check };
      } finally { sqlite.close(); }
    };
    try {
      const cards = Array.from({ length: 800 }, (_, index) => ({ id: `lemma-${index}`, word: `शब्द${index}`, pos: 'NOUN',
        definition: 'a long dictionary meaning; '.repeat(1000), frequency: 800-index, minedSentence: null, samples: [] }));
      const original = await inspect(await buildApkg('Test::Large', cards));
      expect(original.bytes).toBeGreaterThan(16 * 1024 * 1024);
      expect(original.integrity).toBe('ok');
      expect(original.notes).toHaveLength(800);
      const edited = await inspect(await buildApkg('Test::Large', [{ ...cards[0]!, definition: 'revised meaning' }]));
      expect(edited.notes[0]).toEqual(original.notes[0]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
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
