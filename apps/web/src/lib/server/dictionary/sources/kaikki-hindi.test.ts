// @vitest-environment node
/**
 * Unit tests for the Kaikki Hindi importer (T-3.10).
 *
 * Pure transform functions are tested directly. The streaming
 * `entries()` async iterator is exercised against a small JSONL fixture
 * checked in under __fixtures__/.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  kaikkiHindiSource,
  kaikkiToImportEntry,
  mapKaikkiPos,
  parseKaikkiLine,
} from './kaikki-hindi.js';
import type { ImportEntry } from '../types.js';

const FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '__fixtures__/kaikki-hindi.jsonl',
);

describe('parseKaikkiLine', () => {
  it('parses a well-formed JSONL row', () => {
    const r = parseKaikkiLine(
      '{"word":"पानी","pos":"noun","senses":[{"glosses":["water"]}]}',
    );
    expect(r?.word).toBe('पानी');
    expect(r?.pos).toBe('noun');
  });

  it('returns null for blank lines', () => {
    expect(parseKaikkiLine('')).toBeNull();
    expect(parseKaikkiLine('   \n')).toBeNull();
  });

  it('returns null for malformed JSON instead of throwing', () => {
    expect(parseKaikkiLine('not-json')).toBeNull();
  });

  it('returns null when the row is missing word or pos', () => {
    expect(parseKaikkiLine('{"pos":"noun"}')).toBeNull();
    expect(parseKaikkiLine('{"word":"x"}')).toBeNull();
  });
});

describe('mapKaikkiPos', () => {
  it('maps the common Wiktionary POS strings to UD tags', () => {
    expect(mapKaikkiPos('noun')).toBe('NOUN');
    expect(mapKaikkiPos('verb')).toBe('VERB');
    expect(mapKaikkiPos('adj')).toBe('ADJ');
    expect(mapKaikkiPos('adv')).toBe('ADV');
    expect(mapKaikkiPos('pron')).toBe('PRON');
    expect(mapKaikkiPos('conj')).toBe('CCONJ');
    expect(mapKaikkiPos('postp')).toBe('ADP');
    expect(mapKaikkiPos('prep')).toBe('ADP');
    expect(mapKaikkiPos('proper_noun')).toBe('PROPN');
  });

  it('is case-insensitive on input', () => {
    expect(mapKaikkiPos('NOUN')).toBe('NOUN');
    expect(mapKaikkiPos('Noun')).toBe('NOUN');
  });

  it('returns null for entry kinds we do not import as lemmas', () => {
    expect(mapKaikkiPos('phrase')).toBeNull();
    expect(mapKaikkiPos('prefix')).toBeNull();
    expect(mapKaikkiPos('abbreviation')).toBeNull();
    expect(mapKaikkiPos('totally-unknown')).toBeNull();
  });
});

describe('kaikkiToImportEntry', () => {
  it('maps a basic noun entry, joining sense glosses with semicolons', () => {
    const out = kaikkiToImportEntry({
      word: 'घर',
      pos: 'noun',
      senses: [{ glosses: ['house'] }, { glosses: ['home'] }],
    });
    expect(out).not.toBeNull();
    expect(out!.headword).toBe('घर');
    expect(out!.pos).toBe('NOUN');
    expect(out!.translations).toHaveLength(2);
    expect(out!.translations[0]!.body).toBe('house');
    expect(out!.translations[1]!.body).toBe('home');
    expect(out!.glossDefault).toBe('house');
  });

  it('joins multiple glosses within a single sense with "; "', () => {
    const out = kaikkiToImportEntry({
      word: 'में',
      pos: 'postp',
      senses: [{ glosses: ['in', 'at', 'into'] }],
    });
    expect(out!.translations[0]!.body).toBe('in; at; into');
  });

  it('synthesizes a stable source_id from headword + pos + sha1(joined glosses)', () => {
    const a = kaikkiToImportEntry({
      word: 'पानी',
      pos: 'noun',
      senses: [{ glosses: ['water'] }, { glosses: ['rain'] }],
    });
    const b = kaikkiToImportEntry({
      word: 'पानी',
      pos: 'noun',
      senses: [{ glosses: ['water'] }, { glosses: ['rain'] }],
    });
    expect(a!.sourceId).toBe(b!.sourceId);
    expect(a!.sourceId).toMatch(/^kaikki:hi:पानी:NOUN:[0-9a-f]{12}$/);
  });

  it('treats a gloss change as a new entity (different source_id)', () => {
    const a = kaikkiToImportEntry({
      word: 'पानी',
      pos: 'noun',
      senses: [{ glosses: ['water'] }],
    });
    const b = kaikkiToImportEntry({
      word: 'पानी',
      pos: 'noun',
      senses: [{ glosses: ['water; liquid'] }],
    });
    expect(a!.sourceId).not.toBe(b!.sourceId);
  });

  it('returns null when senses is empty or all glosses are empty', () => {
    expect(
      kaikkiToImportEntry({ word: 'x', pos: 'noun', senses: [] }),
    ).toBeNull();
    expect(
      kaikkiToImportEntry({
        word: 'x',
        pos: 'noun',
        senses: [{ glosses: ['', '   '] }],
      }),
    ).toBeNull();
  });

  it('returns null when POS is unimportable', () => {
    expect(
      kaikkiToImportEntry({
        word: 'foo',
        pos: 'phrase',
        senses: [{ glosses: ['bar'] }],
      }),
    ).toBeNull();
  });

  it('returns null when headword is empty after NFC + trim', () => {
    expect(
      kaikkiToImportEntry({
        word: '   ',
        pos: 'noun',
        senses: [{ glosses: ['x'] }],
      }),
    ).toBeNull();
  });

  it('falls back to raw_glosses or english when glosses is missing', () => {
    const r = kaikkiToImportEntry({
      word: 'पानी',
      pos: 'noun',
      senses: [{ raw_glosses: ['water (uncountable)'] }],
    });
    expect(r!.translations[0]!.body).toBe('water (uncountable)');
  });

  it('attaches forms but skips the form equal to the headword', () => {
    const r = kaikkiToImportEntry({
      word: 'घर',
      pos: 'noun',
      senses: [{ glosses: ['house'] }],
      forms: [
        { form: 'घर', tags: ['nominative'] },
        { form: 'घरों', tags: ['plural', 'oblique'] },
      ],
    });
    expect(r!.forms).toHaveLength(1);
    expect(r!.forms![0]!.surface).toBe('घरों');
    // T-3.10 leaves features empty pending a UD-FEATS conversion table.
    expect(r!.forms![0]!.features).toEqual({});
  });

  it('NFC-normalizes the headword', () => {
    // U+0915 + U+093C (composed: क + nukta) → vs U+095A (precomposed क़)
    const r = kaikkiToImportEntry({
      word: 'क़',
      pos: 'noun',
      senses: [{ glosses: ['letter qa'] }],
    });
    expect(r!.headword).toBe('क़'.normalize('NFC'));
  });
});

describe('kaikkiHindiSource (streaming over fixture)', () => {
  beforeEach(() => {
    process.env.KAIKKI_HINDI_FILE = FIXTURE;
  });
  afterEach(() => {
    delete process.env.KAIKKI_HINDI_FILE;
  });

  it('exposes the expected metadata', () => {
    expect(kaikkiHindiSource.name).toBe('kaikki-hindi');
    expect(kaikkiHindiSource.language).toBe('hi');
    expect(kaikkiHindiSource.license).toBe('CC-BY-SA-3.0');
    expect(kaikkiHindiSource.sourceAttribution).toContain('Wiktionary');
  });

  it('iterates the fixture and yields only well-formed lemma entries', async () => {
    const out: ImportEntry[] = [];
    for await (const entry of await kaikkiHindiSource.entries()) {
      out.push(entry);
    }
    // Fixture has 13 lines: 8 importable + 1 phrase + 1 non-JSON +
    // 1 empty-senses + 1 empty-word + 1 adverb. Importable: पानी (noun),
    // घर (noun), बोलना (verb), सोना×2 (noun, verb), और (conj), में (postp),
    // बेकार (adj), बहुत (adv). The phrase, non-JSON, empty-senses, and
    // empty-word rows must be filtered.
    expect(out.map((e) => `${e.headword}/${e.pos}`).sort()).toEqual([
      'और/CCONJ',
      'घर/NOUN',
      'पानी/NOUN',
      'बहुत/ADV',
      'बेकार/ADJ',
      'बोलना/VERB',
      'में/ADP',
      'सोना/NOUN',
      'सोना/VERB',
    ]);
  });

  it('preserves the homograph distinction between noun "सोना" (gold) and verb "सोना" (to sleep)', async () => {
    const out: ImportEntry[] = [];
    for await (const entry of await kaikkiHindiSource.entries()) {
      if (entry.headword === 'सोना') out.push(entry);
    }
    expect(out).toHaveLength(2);
    const noun = out.find((e) => e.pos === 'NOUN')!;
    const verb = out.find((e) => e.pos === 'VERB')!;
    expect(noun.translations[0]!.body).toBe('gold');
    expect(verb.translations[0]!.body).toBe('to sleep');
    // Different source_ids so the runner inserts both rows.
    expect(noun.sourceId).not.toBe(verb.sourceId);
  });
});
