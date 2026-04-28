// @vitest-environment node
/**
 * Unit tests for the generic Kaikki importer (T-3.10) plus thin
 * smoke tests on the per-language instantiations (kaikki-hindi,
 * kaikki-marathi). The pure transform functions are language-agnostic
 * — testing them once via the Hindi fixture is enough.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  kaikkiToImportEntry,
  makeKaikkiSource,
  mapKaikkiPos,
  parseKaikkiLine,
} from './kaikki.js';
import { kaikkiHindiSource } from './kaikki-hindi.js';
import { kaikkiMarathiSource } from './kaikki-marathi.js';
import { kaikkiOdiaSource } from './kaikki-odia.js';
import type { ImportEntry } from '../types.js';

const FIXTURES = dirname(fileURLToPath(import.meta.url)) + '/__fixtures__';
const HINDI_FIXTURE = resolve(FIXTURES, 'kaikki-hindi.jsonl');
const MARATHI_FIXTURE = resolve(FIXTURES, 'kaikki-marathi.jsonl');
const ODIA_FIXTURE = resolve(FIXTURES, 'kaikki-odia.jsonl');

const HINDI_OPTS = { script: 'Deva' as const, sourceIdPrefix: 'kaikki:hi' };

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
  it('maps a basic noun entry, joining sense glosses across rows', () => {
    const out = kaikkiToImportEntry(
      {
        word: 'घर',
        pos: 'noun',
        senses: [{ glosses: ['house'] }, { glosses: ['home'] }],
      },
      HINDI_OPTS,
    );
    expect(out).not.toBeNull();
    expect(out!.headword).toBe('घर');
    expect(out!.pos).toBe('NOUN');
    expect(out!.translations).toHaveLength(2);
    expect(out!.translations[0]!.body).toBe('house');
    expect(out!.translations[1]!.body).toBe('home');
    expect(out!.glossDefault).toBe('house');
  });

  it('joins multiple glosses within a single sense with "; "', () => {
    const out = kaikkiToImportEntry(
      {
        word: 'में',
        pos: 'postp',
        senses: [{ glosses: ['in', 'at', 'into'] }],
      },
      HINDI_OPTS,
    );
    expect(out!.translations[0]!.body).toBe('in; at; into');
  });

  it('synthesizes a stable source_id from headword + pos + sha1(joined glosses)', () => {
    const a = kaikkiToImportEntry(
      {
        word: 'पानी',
        pos: 'noun',
        senses: [{ glosses: ['water'] }, { glosses: ['rain'] }],
      },
      HINDI_OPTS,
    );
    const b = kaikkiToImportEntry(
      {
        word: 'पानी',
        pos: 'noun',
        senses: [{ glosses: ['water'] }, { glosses: ['rain'] }],
      },
      HINDI_OPTS,
    );
    expect(a!.sourceId).toBe(b!.sourceId);
    expect(a!.sourceId).toMatch(/^kaikki:hi:पानी:NOUN:[0-9a-f]{12}$/);
  });

  it('respects the sourceIdPrefix from options (multi-language)', () => {
    const r = kaikkiToImportEntry(
      {
        word: 'पाणी',
        pos: 'noun',
        senses: [{ glosses: ['water'] }],
      },
      { script: 'Deva', sourceIdPrefix: 'kaikki:mr' },
    );
    expect(r!.sourceId).toMatch(/^kaikki:mr:पाणी:NOUN:[0-9a-f]{12}$/);
  });

  it('treats a gloss change as a new entity (different source_id)', () => {
    const a = kaikkiToImportEntry(
      { word: 'पानी', pos: 'noun', senses: [{ glosses: ['water'] }] },
      HINDI_OPTS,
    );
    const b = kaikkiToImportEntry(
      { word: 'पानी', pos: 'noun', senses: [{ glosses: ['water; liquid'] }] },
      HINDI_OPTS,
    );
    expect(a!.sourceId).not.toBe(b!.sourceId);
  });

  it('returns null when senses is empty or all glosses are empty', () => {
    expect(
      kaikkiToImportEntry({ word: 'x', pos: 'noun', senses: [] }, HINDI_OPTS),
    ).toBeNull();
    expect(
      kaikkiToImportEntry(
        { word: 'x', pos: 'noun', senses: [{ glosses: ['', '   '] }] },
        HINDI_OPTS,
      ),
    ).toBeNull();
  });

  it('returns null when POS is unimportable', () => {
    expect(
      kaikkiToImportEntry(
        { word: 'foo', pos: 'phrase', senses: [{ glosses: ['bar'] }] },
        HINDI_OPTS,
      ),
    ).toBeNull();
  });

  it('returns null when headword is empty after NFC + trim', () => {
    expect(
      kaikkiToImportEntry(
        { word: '   ', pos: 'noun', senses: [{ glosses: ['x'] }] },
        HINDI_OPTS,
      ),
    ).toBeNull();
  });

  it('falls back to raw_glosses or english when glosses is missing', () => {
    const r = kaikkiToImportEntry(
      {
        word: 'पानी',
        pos: 'noun',
        senses: [{ raw_glosses: ['water (uncountable)'] }],
      },
      HINDI_OPTS,
    );
    expect(r!.translations[0]!.body).toBe('water (uncountable)');
  });

  it('attaches forms but skips the form equal to the headword', () => {
    const r = kaikkiToImportEntry(
      {
        word: 'घर',
        pos: 'noun',
        senses: [{ glosses: ['house'] }],
        forms: [
          { form: 'घर', tags: ['nominative'] },
          { form: 'घरों', tags: ['plural', 'oblique'] },
        ],
      },
      HINDI_OPTS,
    );
    expect(r!.forms).toHaveLength(1);
    expect(r!.forms![0]!.surface).toBe('घरों');
    expect(r!.forms![0]!.features).toEqual({});
  });

  it('NFC-normalizes the headword', () => {
    const r = kaikkiToImportEntry(
      { word: 'क़', pos: 'noun', senses: [{ glosses: ['letter qa'] }] },
      HINDI_OPTS,
    );
    expect(r!.headword).toBe('क़'.normalize('NFC'));
  });
});

describe('makeKaikkiSource (factory smoke)', () => {
  it('respects the env var for the file path', async () => {
    const source = makeKaikkiSource({
      name: 'kaikki-test',
      language: 'hi',
      script: 'Deva',
      sourceIdPrefix: 'kaikki:test',
      attribution: 'test',
      license: 'CC-BY-SA-3.0',
      envVar: 'KAIKKI_TEST_FILE',
      defaultPath: 'data/dictionaries/kaikki-test/raw.jsonl',
    });
    process.env.KAIKKI_TEST_FILE = HINDI_FIXTURE;
    try {
      const out: ImportEntry[] = [];
      for await (const e of await source.entries()) out.push(e);
      expect(out.length).toBeGreaterThan(0);
    } finally {
      delete process.env.KAIKKI_TEST_FILE;
    }
  });
});

describe('kaikkiHindiSource (streaming over fixture)', () => {
  beforeEach(() => {
    process.env.KAIKKI_HINDI_FILE = HINDI_FIXTURE;
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
    expect(noun.sourceId).not.toBe(verb.sourceId);
  });
});

describe('kaikkiMarathiSource (streaming over fixture)', () => {
  beforeEach(() => {
    process.env.KAIKKI_MARATHI_FILE = MARATHI_FIXTURE;
  });
  afterEach(() => {
    delete process.env.KAIKKI_MARATHI_FILE;
  });

  it('exposes the expected metadata', () => {
    expect(kaikkiMarathiSource.name).toBe('kaikki-marathi');
    expect(kaikkiMarathiSource.language).toBe('mr');
    expect(kaikkiMarathiSource.license).toBe('CC-BY-SA-3.0');
    expect(kaikkiMarathiSource.sourceAttribution).toContain('Marathi');
  });

  it('iterates the Marathi fixture, prefixes source_ids with kaikki:mr', async () => {
    const out: ImportEntry[] = [];
    for await (const entry of await kaikkiMarathiSource.entries()) {
      out.push(entry);
    }
    expect(out.length).toBeGreaterThan(0);
    for (const e of out) {
      expect(e.sourceId.startsWith('kaikki:mr:')).toBe(true);
      expect(e.script).toBe('Deva');
    }
    // Spot-check known entries from the fixture.
    expect(out.find((e) => e.headword === 'पाणी' && e.pos === 'NOUN')).toBeDefined();
  });
});

describe('kaikkiOdiaSource (streaming over fixture)', () => {
  beforeEach(() => {
    process.env.KAIKKI_ODIA_FILE = ODIA_FIXTURE;
  });
  afterEach(() => {
    delete process.env.KAIKKI_ODIA_FILE;
  });

  it('exposes the expected metadata + Odia script identifier', () => {
    expect(kaikkiOdiaSource.name).toBe('kaikki-odia');
    expect(kaikkiOdiaSource.language).toBe('or');
    expect(kaikkiOdiaSource.license).toBe('CC-BY-SA-3.0');
    expect(kaikkiOdiaSource.sourceAttribution).toContain('Odia');
  });

  it('uses the Odia script (Orya) — not silently defaulting to Deva', async () => {
    const out: ImportEntry[] = [];
    for await (const entry of await kaikkiOdiaSource.entries()) {
      out.push(entry);
    }
    expect(out.length).toBeGreaterThan(0);
    for (const e of out) {
      expect(e.script).toBe('Orya');
      expect(e.sourceId.startsWith('kaikki:or:')).toBe(true);
    }
    // Spot-check known entries from the fixture.
    expect(out.find((e) => e.headword === 'ପାଣି' && e.pos === 'NOUN')).toBeDefined();
  });
});
