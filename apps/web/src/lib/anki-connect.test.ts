import { describe, it, expect } from 'vitest';
import {
  buildDeckTree,
  collectEntries,
  defaultMapping,
  readMapping,
  type DesktopCard,
} from './anki-connect';

const card = (
  id: string,
  type: number,
  interval: number,
  queue = type,
  deckName = 'Hindi',
): DesktopCard => ({
  fields: id ? { HindiDB_ID: { value: id } } : {},
  type,
  interval,
  queue,
  deckName,
});

describe('HindiDB Anki vocabulary', () => {
  it('groups nested decks by full path and selects only decks returned by Anki', () => {
    const roots = buildDeckTree([
      'Other::Words',
      'Hindi::Books::Words',
      'Hindi',
      'Hindi::Words',
      'Hindi::Words',
    ]);
    expect(roots.map((node) => node.name)).toEqual(['Hindi', 'Other']);
    expect(roots[0]?.decks).toEqual(['Hindi', 'Hindi::Books::Words', 'Hindi::Words']);
    expect(roots[0]?.children[0]).toMatchObject({
      name: 'Books',
      path: 'Hindi::Books',
      decks: ['Hindi::Books::Words'],
      children: [{ name: 'Words', path: 'Hindi::Books::Words' }],
    });
    expect(roots[1]?.children[0]?.path).toBe('Other::Words');
  });

  it('filters decks and scheduling before combining duplicate notes', () => {
    const cards = [
      card('a', 0, 0),
      card('a', 2, 20),
      card('a', 2, 21, -1),
      card('b', 2, 21),
      card('c', 1, -60),
      card('d', 3, 40),
      card('new', 0, 0),
      card('elsewhere', 2, 100, 2, 'Other'),
      card('', 2, 22),
    ];
    cards[0]!.fields.Lemma = { value: '<b>भी</b>' };
    expect(collectEntries(cards, ['Hindi'], defaultMapping)).toEqual({
      headwords: new Map([['a', 'भी']]),
      missingId: 1,
      ignoredIds: ['a', 'new'],
      entries: [
        { id: 'b', status: 'known' },
        { id: 'c', status: 'learning' },
        { id: 'd', status: 'learning' },
      ],
    });
    expect(
      collectEntries(cards, ['Hindi'], {
        new: 'known',
        young: 'learning',
        mature: 'ignore',
        suspended: 'known',
      }).entries,
    ).toEqual([
      { id: 'a', status: 'known' },
      { id: 'c', status: 'learning' },
      { id: 'd', status: 'learning' },
      { id: 'new', status: 'known' },
    ]);
    expect(
      collectEntries([card('a', 0, 0), card('a', 2, 21)], ['Hindi'], defaultMapping).entries,
    ).toEqual([]);
  });

  it('restores valid assignments and falls back to defaults for missing or invalid ones', () => {
    expect(readMapping('broken')).toEqual(defaultMapping);
    expect(readMapping('null')).toEqual(defaultMapping);
    expect(readMapping('{"new":"known","young":"invalid","suspended":"learning"}')).toEqual({
      ...defaultMapping,
      new: 'known',
      suspended: 'learning',
    });
  });
});
