// @vitest-environment node
/**
 * Unit tests for the generic DSAL importer factory plus smoke tests on
 * the Marathi instantiations (dsal-molesworth, dsal-vaze).
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  MARATHI_POS_MAP,
  NFC_ONLY_NORMALIZER,
  PLATTS_POS_MAP,
  dsalRecordToImportEntry,
  dsalSourceId,
  mapDsalPos,
  trimGloss,
} from './dsal.js';
import { dsalMolesworthSource } from './dsal-molesworth.js';
import { dsalPlattsSource } from './dsal-platts.js';
import {
  dsalPraharajSource,
  latinShare,
  mapPraharajPos,
  praharajGlossLanguage,
} from './dsal-praharaj.js';
import { dsalVazeSource } from './dsal-vaze.js';
import { findSource } from './index.js';
import type { DsalRecord } from '../dsal/records.js';
import type { ImportEntry } from '../types.js';

const FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '__fixtures__',
  'dsal-molesworth.jsonl',
);

const rec = (overrides: Partial<DsalRecord>): DsalRecord => ({
  slug: 'dsal-molesworth',
  hw: 'कमळ',
  senses: ['A lotus.'],
  page: 132,
  ord: 0,
  ...overrides,
});

const OPTS = { name: 'dsal-molesworth', script: 'Deva', posMap: MARATHI_POS_MAP };

describe('mapDsalPos', () => {
  it('maps Marathi gender markers onto NOUN', () => {
    expect(mapDsalPos('m', MARATHI_POS_MAP)).toBe('NOUN');
    expect(mapDsalPos('f', MARATHI_POS_MAP)).toBe('NOUN');
    expect(mapDsalPos('n', MARATHI_POS_MAP)).toBe('NOUN');
  });

  it('maps adjectives, adverbs, and verb compounds via first-token cleanup', () => {
    expect(mapDsalPos('a', MARATHI_POS_MAP)).toBe('ADJ');
    expect(mapDsalPos('ad', MARATHI_POS_MAP)).toBe('ADV');
    expect(mapDsalPos('v i', MARATHI_POS_MAP)).toBe('VERB');
    expect(mapDsalPos('V. T.', MARATHI_POS_MAP)).toBe('VERB');
  });

  it('returns null for unknown or missing markers', () => {
    expect(mapDsalPos('zzz', MARATHI_POS_MAP)).toBeNull();
    expect(mapDsalPos(undefined, MARATHI_POS_MAP)).toBeNull();
  });

  it('maps Platts gendered substantive and valency-verb abbreviations', () => {
    expect(mapDsalPos('s.m.', PLATTS_POS_MAP)).toBe('NOUN');
    expect(mapDsalPos('s.f.', PLATTS_POS_MAP)).toBe('NOUN');
    expect(mapDsalPos('v.n.', PLATTS_POS_MAP)).toBe('VERB');
    expect(mapDsalPos('v.t.', PLATTS_POS_MAP)).toBe('VERB');
    expect(mapDsalPos('adj.', PLATTS_POS_MAP)).toBe('ADJ');
    expect(mapDsalPos('intj.', PLATTS_POS_MAP)).toBe('INTJ');
  });
});

describe('trimGloss', () => {
  it('returns short glosses untouched', () => {
    expect(trimGloss('A lotus.')).toBe('A lotus.');
  });

  it('trims long glosses at a word boundary with an ellipsis', () => {
    const long = 'word '.repeat(60).trim();
    const trimmed = trimGloss(long);
    expect(trimmed.length).toBeLessThanOrEqual(161);
    expect(trimmed.endsWith('…')).toBe(true);
    expect(trimmed).not.toMatch(/wor…$/);
  });
});

describe('dsalSourceId', () => {
  it('keys on the print artifact: dictionary, raw headword, page, ordinal', () => {
    expect(dsalSourceId('dsal-molesworth', rec({}))).toBe('dsal:molesworth:कमळ:132:0');
    expect(dsalSourceId('dsal-molesworth', rec({ ord: 1 }))).toBe('dsal:molesworth:कमळ:132:1');
  });

  it('falls back to a sense hash when the page ref is missing', () => {
    const id = dsalSourceId('dsal-molesworth', rec({ page: undefined }));
    expect(id).toMatch(/^dsal:molesworth:कमळ:h[0-9a-f]{12}:0$/);
  });
});

describe('dsalRecordToImportEntry', () => {
  it('converts a record with per-sense translations and a trimmed default gloss', () => {
    const entry = dsalRecordToImportEntry(
      rec({ senses: ['First sense.', 'Second sense.'], posRaw: 'n' }),
      OPTS,
    )!;
    expect(entry.headword).toBe('कमळ');
    expect(entry.pos).toBe('NOUN');
    expect(entry.script).toBe('Deva');
    expect(entry.glossDefault).toBe('First sense.');
    expect(entry.translations).toEqual([
      { sourceId: 'dsal:molesworth:कमळ:132:0:s0', body: 'First sense.' },
      { sourceId: 'dsal:molesworth:कमळ:132:0:s1', body: 'Second sense.' },
    ]);
    expect(entry.forms).toBeUndefined();
  });

  it('falls back to UD X for unmapped POS markers instead of dropping the entry', () => {
    expect(dsalRecordToImportEntry(rec({ posRaw: 'zzz' }), OPTS)!.pos).toBe('X');
    expect(dsalRecordToImportEntry(rec({ posRaw: undefined }), OPTS)!.pos).toBe('X');
  });

  it('stamps targetLanguage per sense when glossLanguageFor is provided', () => {
    const entry = dsalRecordToImportEntry(rec({ senses: ['ଓଡ଼ିଆ', 'English'] }), {
      ...OPTS,
      glossLanguageFor: (s) => (/[A-Za-z]/.test(s) ? 'en' : 'or'),
    })!;
    expect(entry.translations[0]!.targetLanguage).toBe('or');
    expect(entry.translations[1]!.targetLanguage).toBe('en');
  });

  it('applies the normalizer to the lemma headword but keys source_id on the raw spelling', () => {
    const entry = dsalRecordToImportEntry(rec({}), {
      ...OPTS,
      normalizer: { toModern: (s) => `${NFC_ONLY_NORMALIZER.toModern(s)}_modern` },
    })!;
    expect(entry.headword).toBe('कमळ_modern');
    expect(entry.sourceId).toBe('dsal:molesworth:कमळ:132:0');
  });

  it('returns null for empty headwords and gloss-less records', () => {
    expect(dsalRecordToImportEntry(rec({ hw: '  ' }), OPTS)).toBeNull();
    expect(dsalRecordToImportEntry(rec({ senses: ['', '  '] }), OPTS)).toBeNull();
  });
});

describe('makeDsalSource streaming (via dsal-molesworth)', () => {
  afterEach(() => {
    delete process.env.DSAL_MOLESWORTH_FILE;
  });

  it('streams importable entries from the JSONL artifact, skipping junk rows', async () => {
    process.env.DSAL_MOLESWORTH_FILE = FIXTURE;
    const entries: ImportEntry[] = [];
    for await (const entry of dsalMolesworthSource.entries()) entries.push(entry);

    // 10 fixture lines: 7 importable, 1 empty-sense, 1 non-JSON, 1 empty headword.
    expect(entries).toHaveLength(7);

    const vijnana = entries.find((e) => e.headword === 'विज्ञान')!;
    expect(vijnana.pos).toBe('NOUN');
    expect(vijnana.translations).toHaveLength(4);

    // Homographs on the same page stay distinct rows.
    const kamal = entries.filter((e) => e.headword === 'कमळ');
    expect(kamal.map((e) => e.sourceId)).toEqual([
      'dsal:molesworth:कमळ:132:0',
      'dsal:molesworth:कमळ:132:1',
    ]);

    expect(entries.find((e) => e.headword === 'धांवणें')!.pos).toBe('VERB');
    expect(entries.find((e) => e.headword === 'अर्थात्')!.pos).toBe('ADV');
    expect(entries.find((e) => e.headword === 'पाऊणकी')!.pos).toBe('X');
  });
});

describe('registry wiring', () => {
  it('exposes both Marathi DSAL sources with public-domain licensing', () => {
    for (const source of [dsalMolesworthSource, dsalVazeSource]) {
      expect(findSource(source.name)).toBe(source);
      expect(source.language).toBe('mr');
      expect(source.license).toBe('PublicDomain');
      expect(source.sourceAttribution).toContain('via DSAL, University of Chicago');
    }
  });

  it('exposes Platts as a Hindi source over Devanagari headwords', () => {
    expect(findSource('dsal-platts')).toBe(dsalPlattsSource);
    expect(dsalPlattsSource.language).toBe('hi');
    expect(dsalPlattsSource.license).toBe('PublicDomain');
  });

  it('exposes Praharaj as an Odia source with its qualified license string', () => {
    expect(findSource('dsal-praharaj')).toBe(dsalPraharajSource);
    expect(dsalPraharajSource.language).toBe('or');
    expect(dsalPraharajSource.license).toContain('PublicDomain-IN-EU');
  });
});

describe('mapPraharajPos', () => {
  it('token-searches the gramGrp marker past the etymology prefix', () => {
    expect(mapPraharajPos('ସଂ. ବି. (ଅଭି+ଧା ଧାତୁ+ଭାବ. ଅନ)')).toBe('NOUN');
    expect(mapPraharajPos('ଦେ. ବିଣ.')).toBe('ADJ');
    expect(mapPraharajPos('ସଂ. କ୍ରି.')).toBe('VERB');
    expect(mapPraharajPos('କ୍ରି. ବିଣ.')).toBe('ADV');
    expect(mapPraharajPos('ସର୍ବ.')).toBe('PRON');
  });

  it('returns null for unrecognized or missing markers', () => {
    expect(mapPraharajPos('ସଂ.')).toBeNull();
    expect(mapPraharajPos(undefined)).toBeNull();
  });
});

describe('praharajGlossLanguage', () => {
  it('tags English-bearing senses en and pure-Odia senses or', () => {
    expect(praharajGlossLanguage('Vocabulary; dictionary; lexicon.')).toBe('en');
    expect(praharajGlossLanguage('କଥନ — 1. Speaking.')).toBe('en');
    expect(praharajGlossLanguage('ପୁତ୍ରଙ୍କର ଅଭିଧାନ ବିଧାନ କରିବେ। ଆନନ୍ଦଚନ୍ଦ୍ର. ଭକ୍ତ ପ୍ରହ୍ଲାଦ।')).toBe('or');
    expect(
      praharajGlossLanguage('ଯେଉଁ ପୁସ୍ତକରେ ଶବ୍ଦର ଅର୍ଥ ଥାଏ; ଶବ୍ଦାର୍ଥକୋଷ; ଡିକ୍ସିନାରୀ — 3. Vocabulary.'),
    ).toBe('or');
  });

  it('latinShare ignores digits and punctuation', () => {
    expect(latinShare('1. 2. 3.')).toBe(0);
    expect(latinShare('abc')).toBe(1);
  });
});

describe('Praharaj record conversion', () => {
  it('emits per-sense definition languages through the factory', () => {
    const entry = dsalRecordToImportEntry(
      {
        slug: 'dsal-praharaj',
        hw: 'ଅଭିଧାନ',
        translit: 'Abhidhāna',
        posRaw: 'ସଂ. ବି. (ଅଭି+ଧା ଧାତୁ+ଭାବ. ଅନ)',
        senses: [
          'କଥନ — 1. Speaking.',
          'ପୁତ୍ରଙ୍କର ଅଭିଧାନ ବିଧାନ କରିବେ। ଆନନ୍ଦଚନ୍ଦ୍ର।',
        ],
        page: 495,
        ord: 0,
      },
      {
        name: 'dsal-praharaj',
        script: 'Orya',
        posMap: {},
        mapPos: mapPraharajPos,
        glossLanguageFor: praharajGlossLanguage,
      },
    )!;
    expect(entry.headword).toBe('ଅଭିଧାନ');
    expect(entry.pos).toBe('NOUN');
    expect(entry.sourceId).toBe('dsal:praharaj:ଅଭିଧାନ:495:0');
    expect(entry.translations[0]!.targetLanguage).toBe('en');
    expect(entry.translations[1]!.targetLanguage).toBe('or');
  });
});

describe('Platts record conversion', () => {
  it('imports the Devanagari headword; Perso-Arabic alternates never become forms', () => {
    const entry = dsalRecordToImportEntry(
      {
        slug: 'dsal-platts',
        hw: 'कमल',
        hwAlt: ['کمل'],
        translit: 'kamal',
        posRaw: 's.m.',
        senses: ['s.m. The lotus, Nelumbium speciosum.'],
        page: 849,
        ord: 0,
      },
      { name: 'dsal-platts', script: 'Deva', posMap: PLATTS_POS_MAP },
    )!;
    expect(entry.headword).toBe('कमल');
    expect(entry.pos).toBe('NOUN');
    expect(entry.sourceId).toBe('dsal:platts:कमल:849:0');
    expect(entry.forms).toBeUndefined();
  });
});
