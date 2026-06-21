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
import { kaikkiBasqueEsSource } from './kaikki-basque-es.js';
import { kaikkiBasqueSource } from './kaikki-basque.js';
import { kaikkiHindiSource } from './kaikki-hindi.js';
import { kaikkiMarathiSource } from './kaikki-marathi.js';
import { kaikkiOdiaSource } from './kaikki-odia.js';
import { kaikkiYiddishSource } from './kaikki-yiddish.js';
import type { ImportEntry } from '../types.js';

const FIXTURES = dirname(fileURLToPath(import.meta.url)) + '/__fixtures__';
const HINDI_FIXTURE = resolve(FIXTURES, 'kaikki-hindi.jsonl');
const MARATHI_FIXTURE = resolve(FIXTURES, 'kaikki-marathi.jsonl');
const ODIA_FIXTURE = resolve(FIXTURES, 'kaikki-odia.jsonl');
const YIDDISH_FIXTURE = resolve(FIXTURES, 'kaikki-yiddish.jsonl');
const BASQUE_FIXTURE = resolve(FIXTURES, 'kaikki-basque.jsonl');
const BASQUE_ES_FIXTURE = resolve(FIXTURES, 'kaikki-basque-es.jsonl');

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

  const EU_ROOT_OPTS = {
    script: 'Latn' as const,
    sourceIdPrefix: 'kaikki:eu',
    rootFormsOnly: true,
  };

  it('rootFormsOnly: keeps the root entry but drops its inflection table', () => {
    const r = kaikkiToImportEntry(
      {
        word: 'etxe',
        pos: 'noun',
        senses: [{ glosses: ['house'] }],
        forms: [
          { form: 'etxea', tags: ['absolutive', 'singular'] },
          { form: 'etxean', tags: ['inessive', 'singular'] },
        ],
      },
      EU_ROOT_OPTS,
    );
    expect(r).not.toBeNull();
    expect(r!.headword).toBe('etxe');
    expect(r!.forms).toBeUndefined();
  });

  it('rootFormsOnly: skips a "form-of" entry (an inflection of another lemma)', () => {
    const r = kaikkiToImportEntry(
      {
        word: 'etxean',
        pos: 'noun',
        senses: [
          {
            glosses: ['inessive singular of etxe'],
            form_of: [{ word: 'etxe' }],
            tags: ['form-of'],
          },
        ],
      },
      EU_ROOT_OPTS,
    );
    expect(r).toBeNull();
  });

  it('rootFormsOnly: keeps an entry that has a real sense beside a form-of sense', () => {
    const r = kaikkiToImportEntry(
      {
        word: 'maite',
        pos: 'adj',
        senses: [
          { glosses: ['beloved, dear'] },
          { glosses: ['inflection of maitatu'], form_of: [{ word: 'maitatu' }] },
        ],
      },
      EU_ROOT_OPTS,
    );
    expect(r).not.toBeNull();
    expect(r!.headword).toBe('maite');
  });

  it('without rootFormsOnly, the inflection table is still imported', () => {
    const r = kaikkiToImportEntry(
      {
        word: 'etxe',
        pos: 'noun',
        senses: [{ glosses: ['house'] }],
        forms: [{ form: 'etxean', tags: ['inessive'] }],
      },
      { script: 'Latn', sourceIdPrefix: 'kaikki:eu' },
    );
    expect(r!.forms).toHaveLength(1);
    expect(r!.forms![0]!.surface).toBe('etxean');
  });

  it('NFC-normalizes the headword', () => {
    const r = kaikkiToImportEntry(
      { word: 'क़', pos: 'noun', senses: [{ glosses: ['letter qa'] }] },
      HINDI_OPTS,
    );
    expect(r!.headword).toBe('क़'.normalize('NFC'));
  });

  it('stamps targetLanguage on every translation when glossLanguage is set', () => {
    const r = kaikkiToImportEntry(
      { word: 'etxe', pos: 'noun', senses: [{ glosses: ['casa'] }, { glosses: ['hogar'] }] },
      { script: 'Latn', sourceIdPrefix: 'kaikki:eu-es', glossLanguage: 'es' },
    );
    expect(r!.translations).toHaveLength(2);
    for (const t of r!.translations) expect(t.targetLanguage).toBe('es');
  });

  it('leaves targetLanguage undefined when glossLanguage is omitted (runner defaults to en)', () => {
    const r = kaikkiToImportEntry(
      { word: 'पानी', pos: 'noun', senses: [{ glosses: ['water'] }] },
      HINDI_OPTS,
    );
    expect(r!.translations[0]!.targetLanguage).toBeUndefined();
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

describe('kaikkiYiddishSource (streaming over fixture)', () => {
  beforeEach(() => {
    process.env.KAIKKI_YIDDISH_FILE = YIDDISH_FIXTURE;
  });
  afterEach(() => {
    delete process.env.KAIKKI_YIDDISH_FILE;
  });

  it('exposes the expected metadata + Hebrew script identifier', () => {
    expect(kaikkiYiddishSource.name).toBe('kaikki-yiddish');
    expect(kaikkiYiddishSource.language).toBe('yi');
    expect(kaikkiYiddishSource.license).toBe('CC-BY-SA-3.0');
    expect(kaikkiYiddishSource.sourceAttribution).toContain('Yiddish');
  });

  it('uses the Hebrew script (Hebr) — first non-Brahmic import path', async () => {
    const out: ImportEntry[] = [];
    for await (const entry of await kaikkiYiddishSource.entries()) {
      out.push(entry);
    }
    expect(out.length).toBeGreaterThan(0);
    for (const e of out) {
      expect(e.script).toBe('Hebr');
      expect(e.sourceId.startsWith('kaikki:yi:')).toBe(true);
    }
    // Spot-check known entries from the fixture, including pointed
    // letters and the pasekh-tsvey-yudn ligature.
    expect(out.find((e) => e.headword === 'בוך' && e.pos === 'NOUN')).toBeDefined();
    expect(out.find((e) => e.headword === 'שרײַבן' && e.pos === 'VERB')).toBeDefined();
    // The 'article' POS isn't in the POS map and must be skipped.
    expect(out.find((e) => e.headword === 'אַ')).toBeUndefined();
  });

  it('carries inflected forms (plural, participle) for lemma_forms', async () => {
    const out: ImportEntry[] = [];
    for await (const entry of await kaikkiYiddishSource.entries()) {
      out.push(entry);
    }
    const bukh = out.find((e) => e.headword === 'בוך')!;
    expect(bukh.forms?.map((f) => f.surface)).toContain('ביכער');
    const shraybn = out.find((e) => e.headword === 'שרײַבן')!;
    expect(shraybn.forms?.map((f) => f.surface)).toContain('געשריבן');
  });
});

describe('kaikkiBasqueSource (streaming over fixture)', () => {
  beforeEach(() => {
    process.env.KAIKKI_BASQUE_FILE = BASQUE_FIXTURE;
  });
  afterEach(() => {
    delete process.env.KAIKKI_BASQUE_FILE;
  });

  it('exposes the expected metadata + Latin script identifier', () => {
    expect(kaikkiBasqueSource.name).toBe('kaikki-basque');
    expect(kaikkiBasqueSource.language).toBe('eu');
    expect(kaikkiBasqueSource.license).toBe('CC-BY-SA-3.0');
    expect(kaikkiBasqueSource.sourceAttribution).toContain('Basque');
  });

  it('uses the Latin script (Latn) — first Latin-script import path', async () => {
    const out: ImportEntry[] = [];
    for await (const entry of await kaikkiBasqueSource.entries()) {
      out.push(entry);
    }
    expect(out.length).toBeGreaterThan(0);
    for (const e of out) {
      expect(e.script).toBe('Latn');
      expect(e.sourceId.startsWith('kaikki:eu:')).toBe(true);
    }
    // Spot-check known entries from the fixture.
    expect(out.find((e) => e.headword === 'etxe' && e.pos === 'NOUN')).toBeDefined();
    expect(out.find((e) => e.headword === 'idatzi' && e.pos === 'VERB')).toBeDefined();
    // The 'suffix' POS isn't in the POS map and must be skipped.
    expect(out.find((e) => e.headword === '-tik')).toBeUndefined();
  });

  it('imports root forms only — drops each entry inflection table', async () => {
    const out: ImportEntry[] = [];
    for await (const entry of await kaikkiBasqueSource.entries()) {
      out.push(entry);
    }
    // Basque morphology is handled by the Stanza pipeline, so the importer
    // keeps only citation forms and skips the conjugated/declined surfaces.
    expect(out.find((e) => e.headword === 'etxe')!.forms).toBeUndefined();
    for (const e of out) expect(e.forms ?? []).toHaveLength(0);
  });

  it('stamps English as the definition language (targetLanguage "en")', async () => {
    const out: ImportEntry[] = [];
    for await (const entry of await kaikkiBasqueSource.entries()) out.push(entry);
    const etxe = out.find((e) => e.headword === 'etxe')!;
    for (const t of etxe.translations) expect(t.targetLanguage).toBe('en');
  });
});

describe('kaikkiBasqueEsSource (Spanish-glossed, streaming over fixture)', () => {
  beforeEach(() => {
    process.env.KAIKKI_BASQUE_ES_FILE = BASQUE_ES_FIXTURE;
  });
  afterEach(() => {
    delete process.env.KAIKKI_BASQUE_ES_FILE;
  });

  it('exposes eu metadata with the Spanish-edition attribution + distinct prefix', () => {
    expect(kaikkiBasqueEsSource.name).toBe('kaikki-basque-es');
    expect(kaikkiBasqueEsSource.language).toBe('eu');
    expect(kaikkiBasqueEsSource.license).toBe('CC-BY-SA-3.0');
    expect(kaikkiBasqueEsSource.sourceAttribution).toContain('eswiktionary');
  });

  it('stamps every translation with targetLanguage "es" and a kaikki:eu-es source_id', async () => {
    const out: ImportEntry[] = [];
    for await (const entry of await kaikkiBasqueEsSource.entries()) out.push(entry);
    expect(out.length).toBeGreaterThan(0);
    for (const e of out) {
      expect(e.script).toBe('Latn');
      expect(e.sourceId.startsWith('kaikki:eu-es:')).toBe(true);
      for (const t of e.translations) expect(t.targetLanguage).toBe('es');
    }
    // Spot-check a Spanish gloss; the 'suffix' POS is skipped.
    const etxe = out.find((e) => e.headword === 'etxe' && e.pos === 'NOUN')!;
    expect(etxe.translations[0]!.body).toBe('casa');
    expect(out.find((e) => e.headword === '-tik')).toBeUndefined();
  });
});
