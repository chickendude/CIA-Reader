// @vitest-environment node
/**
 * Shared CFILT IndoWordNet parser tests (T-3.10a/c).
 *
 * Covers the TSV parser, POS map, and synset → ImportEntry expansion.
 * Per-language smoke tests (Hindi, Marathi, …) live alongside their
 * thin instantiations and lock in language-specific knobs only —
 * everything else routes through this file.
 */
import { describe, expect, it } from 'vitest';

import {
  mapWordNetPos,
  parseSynsetLine,
  synsetRowToEntries,
} from './indo-wordnet.js';

const HI_OPTS = {
  language: 'hi' as const,
  script: 'Deva',
  sourceIdPrefix: 'hwn',
};

describe('mapWordNetPos', () => {
  it('maps the four core WordNet categories to UD tags', () => {
    expect(mapWordNetPos('noun')).toBe('NOUN');
    expect(mapWordNetPos('verb')).toBe('VERB');
    expect(mapWordNetPos('adjective')).toBe('ADJ');
    expect(mapWordNetPos('adverb')).toBe('ADV');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(mapWordNetPos('NOUN')).toBe('NOUN');
    expect(mapWordNetPos('  Adjective  ')).toBe('ADJ');
  });

  it('returns null for unsupported categories', () => {
    expect(mapWordNetPos('idiom')).toBeNull();
    expect(mapWordNetPos('')).toBeNull();
  });
});

describe('parseSynsetLine', () => {
  it('parses a 5-column synset row', () => {
    const row = parseSynsetLine(
      '1234\tnoun\tवह जो पढ़ने के लिए हो\tमैंने एक किताब पढ़ी\tकिताब,पुस्तक',
    );
    expect(row).toEqual({
      synsetId: '1234',
      category: 'noun',
      concept: 'वह जो पढ़ने के लिए हो',
      example: 'मैंने एक किताब पढ़ी',
      words: ['किताब', 'पुस्तक'],
    });
  });

  it('drops blank lines, # comments, and rows with too few columns', () => {
    expect(parseSynsetLine('')).toBeNull();
    expect(parseSynsetLine('   ')).toBeNull();
    expect(parseSynsetLine('# comment')).toBeNull();
    expect(parseSynsetLine('1\t2\t3')).toBeNull();
  });

  it('drops rows with empty words', () => {
    expect(parseSynsetLine('5\tnoun\tdef\texample\t')).toBeNull();
  });

  it('accepts both comma- and semicolon-separated word lists', () => {
    const row = parseSynsetLine('9\tverb\tचलना\t-\tदौड़ना;भागना');
    expect(row?.words).toEqual(['दौड़ना', 'भागना']);
  });
});

describe('synsetRowToEntries', () => {
  it('produces one ImportEntry per unique synset member', () => {
    const entries = synsetRowToEntries(
      {
        synsetId: '12345',
        category: 'noun',
        concept: 'a written or printed work',
        example: 'मैंने एक किताब पढ़ी',
        words: ['किताब', 'पुस्तक'],
      },
      HI_OPTS,
    );
    expect(entries).toHaveLength(2);
    expect(entries[0]!.headword).toBe('किताब');
    expect(entries[0]!.pos).toBe('NOUN');
    expect(entries[0]!.script).toBe('Deva');
    expect(entries[0]!.sourceId).toBe('hwn:12345:0');
    expect(entries[0]!.translations[0]!.body).toBe('a written or printed work');
    expect(entries[0]!.translations[0]!.targetLanguage).toBe('hi');
    expect(entries[1]!.sourceId).toBe('hwn:12345:1');
  });

  it('deduplicates repeated members within the same synset', () => {
    const entries = synsetRowToEntries(
      {
        synsetId: '99',
        category: 'noun',
        concept: 'def',
        example: '',
        words: ['क', 'क', 'ख'],
      },
      HI_OPTS,
    );
    expect(entries.map((e) => e.headword)).toEqual(['क', 'ख']);
  });

  it('drops the row when POS is unmapped', () => {
    const entries = synsetRowToEntries(
      {
        synsetId: '1',
        category: 'idiom',
        concept: 'def',
        example: '',
        words: ['x'],
      },
      HI_OPTS,
    );
    expect(entries).toHaveLength(0);
  });

  it('drops the row when concept is empty', () => {
    expect(
      synsetRowToEntries(
        {
          synsetId: '1',
          category: 'noun',
          concept: '',
          example: '',
          words: ['x'],
        },
        HI_OPTS,
      ),
    ).toHaveLength(0);
  });

  it('NFC-normalizes headwords and trims whitespace', () => {
    const nfd = 'दा'.normalize('NFD');
    const entries = synsetRowToEntries(
      {
        synsetId: '7',
        category: 'noun',
        concept: 'def',
        example: '',
        words: [`  ${nfd}  `],
      },
      HI_OPTS,
    );
    expect(entries[0]!.headword).toBe('दा');
  });

  it('passes the source language through to the translation row', () => {
    const entries = synsetRowToEntries(
      {
        synsetId: '8',
        category: 'noun',
        concept: 'पुस्तक',
        example: '',
        words: ['किताब'],
      },
      { language: 'hi', script: 'Deva', sourceIdPrefix: 'hwn' },
    );
    expect(entries[0]!.translations[0]!.targetLanguage).toBe('hi');

    const mr = synsetRowToEntries(
      {
        synsetId: '8',
        category: 'noun',
        concept: 'पुस्तक',
        example: '',
        words: ['पुस्तक'],
      },
      { language: 'mr', script: 'Deva', sourceIdPrefix: 'mwn' },
    );
    expect(mr[0]!.translations[0]!.targetLanguage).toBe('mr');
    expect(mr[0]!.sourceId).toBe('mwn:8:0');
  });
});
