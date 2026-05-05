// @vitest-environment node
/**
 * Hindi WordNet importer tests (T-3.10a).
 *
 * Fixture-based — verifies the TSV parser, POS mapping, multi-word
 * synset expansion, and stable sourceId. The actual dump may need
 * registration with CFILT, so we don't run a real-file integration
 * test here.
 */
import { describe, expect, it } from 'vitest';

import {
  hindiWordnetSource,
  hwnRowToEntries,
  mapWordNetPos,
  parseHwnLine,
} from './hindi-wordnet.js';

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

describe('parseHwnLine', () => {
  it('parses a 5-column synset row', () => {
    const row = parseHwnLine('1234\tnoun\tवह जो पढ़ने के लिए हो\tमैंने एक किताब पढ़ी\tकिताब,पुस्तक');
    expect(row).toEqual({
      synsetId: '1234',
      category: 'noun',
      concept: 'वह जो पढ़ने के लिए हो',
      example: 'मैंने एक किताब पढ़ी',
      words: ['किताब', 'पुस्तक'],
    });
  });

  it('drops blank lines, # comments, and rows with too few columns', () => {
    expect(parseHwnLine('')).toBeNull();
    expect(parseHwnLine('   ')).toBeNull();
    expect(parseHwnLine('# comment')).toBeNull();
    expect(parseHwnLine('1\t2\t3')).toBeNull();
  });

  it('drops rows with empty words', () => {
    expect(parseHwnLine('5\tnoun\tdef\texample\t')).toBeNull();
  });

  it('accepts both comma- and semicolon-separated word lists', () => {
    const row = parseHwnLine('9\tverb\tचलना\t-\tदौड़ना;भागना');
    expect(row?.words).toEqual(['दौड़ना', 'भागना']);
  });
});

describe('hwnRowToEntries', () => {
  it('produces one ImportEntry per unique synset member', () => {
    const entries = hwnRowToEntries({
      synsetId: '12345',
      category: 'noun',
      concept: 'a written or printed work',
      example: 'मैंने एक किताब पढ़ी',
      words: ['किताब', 'पुस्तक'],
    });
    expect(entries).toHaveLength(2);
    expect(entries[0]!.headword).toBe('किताब');
    expect(entries[0]!.pos).toBe('NOUN');
    expect(entries[0]!.sourceId).toBe('hwn:12345:0');
    expect(entries[0]!.translations[0]!.body).toBe('a written or printed work');
    expect(entries[0]!.translations[0]!.targetLanguage).toBe('hi');
    expect(entries[1]!.sourceId).toBe('hwn:12345:1');
  });

  it('deduplicates repeated members within the same synset', () => {
    const entries = hwnRowToEntries({
      synsetId: '99',
      category: 'noun',
      concept: 'def',
      example: '',
      words: ['क', 'क', 'ख'],
    });
    expect(entries.map((e) => e.headword)).toEqual(['क', 'ख']);
  });

  it('drops the row when POS is unmapped', () => {
    const entries = hwnRowToEntries({
      synsetId: '1',
      category: 'idiom',
      concept: 'def',
      example: '',
      words: ['x'],
    });
    expect(entries).toHaveLength(0);
  });

  it('drops the row when concept is empty', () => {
    expect(
      hwnRowToEntries({
        synsetId: '1',
        category: 'noun',
        concept: '',
        example: '',
        words: ['x'],
      }),
    ).toHaveLength(0);
  });

  it('NFC-normalizes headwords and trims whitespace', () => {
    // NFD form for ḍa (दा) — should normalize to NFC.
    const nfd = 'दा'.normalize('NFD');
    const entries = hwnRowToEntries({
      synsetId: '7',
      category: 'noun',
      concept: 'def',
      example: '',
      words: [`  ${nfd}  `],
    });
    expect(entries[0]!.headword).toBe('दा');
  });
});

describe('hindiWordnetSource registry shape', () => {
  it('exposes the expected attribution + license + language', () => {
    expect(hindiWordnetSource.name).toBe('hindi-wordnet');
    expect(hindiWordnetSource.language).toBe('hi');
    expect(hindiWordnetSource.license).toContain('Research-Use');
    expect(hindiWordnetSource.sourceAttribution).toContain('CFILT');
  });
});
