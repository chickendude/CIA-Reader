// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

let queue: unknown[][] = [];

vi.mock('../db/index.js', () => {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'innerJoin']) {
    chain[m] = () => chain;
  }
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    resolve(queue.shift() ?? []);
  return {
    db: chain,
    schema: {
      lemmas: {
        id: 'l.id',
        headword: 'l.headword',
        pos: 'l.pos',
        glossDefault: 'l.gloss',
        frequencyRank: 'l.freq',
        language: 'l.language',
      },
      translations: {
        targetId: 'tr.target_id',
        targetType: 'tr.target_type',
        body: 'tr.body',
        targetLanguage: 'tr.lang',
        source: 'tr.source',
        hidden: 'tr.hidden',
      },
    },
  };
});

import { buildDictionaryExport } from './export.js';

beforeEach(() => {
  queue = [];
});

describe('buildDictionaryExport', () => {
  it('assembles lemmas with their translations bucketed by kind', async () => {
    queue = [
      // lemma rows
      [
        { id: 'L1', headword: 'etxe', pos: 'NOUN', gloss: 'house', freq: 5 },
        { id: 'L2', headword: 'jan', pos: 'VERB', gloss: null, freq: 10 },
      ],
      // translation rows
      [
        { targetId: 'L1', body: 'house', lang: 'en', source: 'official_dictionary' },
        { targetId: 'L1', body: 'casa', lang: 'es', source: 'curator' },
        { targetId: 'L1', body: 'home', lang: 'en', source: 'user' },
      ],
    ];

    const out = await buildDictionaryExport('eu');

    expect(out.language).toBe('eu');
    expect(out.count).toBe(2);

    const etxe = out.lemmas.find((l) => l.id === 'L1')!;
    expect(etxe.headword).toBe('etxe');
    expect(etxe.translations).toHaveLength(3);
    expect(etxe.translations.filter((t) => t.kind === 'official')).toHaveLength(2);
    expect(etxe.translations.filter((t) => t.kind === 'community')).toHaveLength(1);

    const jan = out.lemmas.find((l) => l.id === 'L2')!;
    expect(jan.gloss).toBeNull();
    expect(jan.translations).toEqual([]);
  });

  it('handles a language with no translations', async () => {
    queue = [[{ id: 'L1', headword: 'bat', pos: 'NUM', gloss: 'one', freq: 1 }], []];

    const out = await buildDictionaryExport('eu');

    expect(out.count).toBe(1);
    expect(out.lemmas[0]!.translations).toEqual([]);
  });
});
