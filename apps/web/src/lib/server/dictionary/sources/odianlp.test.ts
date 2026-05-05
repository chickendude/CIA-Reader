// @vitest-environment node
/**
 * OdiaNLP curated subset importer tests (T-3.10g).
 *
 * Fixture-based — verifies the JSONL parser, license gating, POS map,
 * and per-entry attribution surface. The license-gate test is the
 * load-bearing one: a row with an unrecognized license must crash
 * the import rather than silently land.
 */
import { describe, expect, it } from 'vitest';

import {
  ODIANLP_ALLOWED_LICENSES,
  OdiaNlpLicenseError,
  mapOdiaNlpPos,
  odiaNlpSource,
  parseOdiaNlpLine,
  rowToImportEntry,
} from './odianlp.js';

describe('mapOdiaNlpPos', () => {
  it('maps the common POS strings to UD tags', () => {
    expect(mapOdiaNlpPos('noun')).toBe('NOUN');
    expect(mapOdiaNlpPos('verb')).toBe('VERB');
    expect(mapOdiaNlpPos('adjective')).toBe('ADJ');
  });

  it('returns null for unmapped POS', () => {
    expect(mapOdiaNlpPos('idiom')).toBeNull();
    expect(mapOdiaNlpPos('')).toBeNull();
  });
});

describe('parseOdiaNlpLine', () => {
  it('accepts a well-formed JSONL row carrying an allowed license', () => {
    const row = parseOdiaNlpLine(
      JSON.stringify({
        id: 'odn-1',
        headword: 'ବହି',
        pos: 'noun',
        definitions: ['book'],
        publisher: 'OdiaNLP / community',
        license: 'MIT',
      }),
    );
    expect(row).toEqual({
      id: 'odn-1',
      headword: 'ବହି',
      pos: 'noun',
      definitions: ['book'],
      publisher: 'OdiaNLP / community',
      license: 'MIT',
    });
  });

  it('throws OdiaNlpLicenseError for unrecognized licenses', () => {
    const line = JSON.stringify({
      id: 'odn-9',
      headword: 'x',
      pos: 'noun',
      definitions: ['x'],
      license: 'Proprietary-WTF',
    });
    expect(() => parseOdiaNlpLine(line)).toThrow(OdiaNlpLicenseError);
  });

  it('throws when the license field is missing entirely', () => {
    const line = JSON.stringify({
      id: 'odn-9',
      headword: 'x',
      pos: 'noun',
      definitions: ['x'],
    });
    expect(() => parseOdiaNlpLine(line)).toThrow(OdiaNlpLicenseError);
  });

  it('skips blank, # comment, and // comment lines', () => {
    expect(parseOdiaNlpLine('')).toBeNull();
    expect(parseOdiaNlpLine('   ')).toBeNull();
    expect(parseOdiaNlpLine('# header')).toBeNull();
    expect(parseOdiaNlpLine('// note')).toBeNull();
  });

  it('drops rows missing a headword or definitions', () => {
    expect(
      parseOdiaNlpLine(JSON.stringify({ pos: 'noun', definitions: ['x'], license: 'MIT' })),
    ).toBeNull();
    expect(
      parseOdiaNlpLine(
        JSON.stringify({ headword: 'x', pos: 'noun', definitions: [], license: 'MIT' }),
      ),
    ).toBeNull();
  });

  it('falls back to the headword as the id when id is empty', () => {
    const row = parseOdiaNlpLine(
      JSON.stringify({
        headword: 'କବିତା',
        pos: 'noun',
        definitions: ['poem'],
        license: 'CC-BY-4.0',
      }),
    );
    expect(row?.id).toBe('କବିତା');
  });
});

describe('rowToImportEntry', () => {
  it('emits per-entry attribution combining publisher + license', () => {
    const entry = rowToImportEntry({
      id: 'odn-7',
      headword: 'ବହି',
      pos: 'noun',
      definitions: ['book', 'volume'],
      publisher: 'OdiaNLP / Subhadarshi',
      license: 'CC-BY-4.0',
    });
    expect(entry).not.toBeNull();
    expect(entry!.headword).toBe('ବହି');
    expect(entry!.pos).toBe('NOUN');
    expect(entry!.script).toBe('Orya');
    expect(entry!.sourceId).toBe('odianlp:odn-7');
    expect(entry!.translations).toHaveLength(2);
    expect(entry!.translations[0]!.sourceAttribution).toBe(
      'OdiaNLP / Subhadarshi (CC-BY-4.0)',
    );
    expect(entry!.translations[1]!.sourceAttribution).toBe(
      'OdiaNLP / Subhadarshi (CC-BY-4.0)',
    );
  });

  it('drops the row when POS is unmapped', () => {
    expect(
      rowToImportEntry({
        id: 'x',
        headword: 'x',
        pos: 'idiom',
        definitions: ['x'],
        publisher: 'p',
        license: 'MIT',
      }),
    ).toBeNull();
  });

  it('NFC-normalizes the headword', () => {
    const nfd = 'ବ'.normalize('NFD');
    const entry = rowToImportEntry({
      id: 'x',
      headword: nfd,
      pos: 'noun',
      definitions: ['def'],
      publisher: 'p',
      license: 'MIT',
    });
    expect(entry!.headword).toBe('ବ');
  });
});

describe('odiaNlpSource registry shape', () => {
  it('exposes the expected attribution and language', () => {
    expect(odiaNlpSource.name).toBe('odianlp');
    expect(odiaNlpSource.language).toBe('or');
    expect(odiaNlpSource.sourceAttribution).toContain('OdiaNLP');
    expect(odiaNlpSource.license).toContain('Mixed');
  });

  it('keeps the allowed-license set in sync with the documented buckets', () => {
    // Tightening or loosening this list is a curator decision; the
    // test exists so a silent edit to the set surfaces in code review.
    expect([...ODIANLP_ALLOWED_LICENSES].sort()).toEqual([
      'CC-BY-3.0',
      'CC-BY-4.0',
      'CC-BY-SA-3.0',
      'CC-BY-SA-4.0',
      'CC0-1.0',
      'MIT',
      'PublicDomain',
    ]);
  });
});
