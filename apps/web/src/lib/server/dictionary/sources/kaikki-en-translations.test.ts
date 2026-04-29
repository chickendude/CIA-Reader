// @vitest-environment node
/**
 * Unit tests for the inverted Kaikki English → Indic-language importer
 * (T-3.10 follow-up). Pure transform functions are tested directly;
 * end-to-end streaming over a small JSONL fixture exercises the
 * per-language smoke for HI / MR / OR.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  enEntryToImportEntries,
  parseKaikkiEnLine,
} from './kaikki-en-translations.js';
import { kaikkiEnTranslationsHindiSource } from './kaikki-en-translations-hindi.js';
import { kaikkiEnTranslationsMarathiSource } from './kaikki-en-translations-marathi.js';
import { kaikkiEnTranslationsOdiaSource } from './kaikki-en-translations-odia.js';
import type { ImportEntry } from '../types.js';

const FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '__fixtures__/kaikki-en-translations.jsonl',
);

const HI_OPTS = {
  targetLang: 'hi' as const,
  script: 'Deva',
  sourceIdPrefix: 'kaikki-en:hi',
};

describe('parseKaikkiEnLine', () => {
  it('parses a well-formed entry with translations', () => {
    const r = parseKaikkiEnLine(
      '{"word":"book","pos":"noun","translations":[{"lang_code":"hi","word":"किताब"}]}',
    );
    expect(r?.word).toBe('book');
    expect(r?.translations).toHaveLength(1);
  });

  it('returns null for blank lines, malformed JSON, and missing word/pos', () => {
    expect(parseKaikkiEnLine('')).toBeNull();
    expect(parseKaikkiEnLine('   ')).toBeNull();
    expect(parseKaikkiEnLine('not-json')).toBeNull();
    expect(parseKaikkiEnLine('{"word":"x"}')).toBeNull();
    expect(parseKaikkiEnLine('{"pos":"noun"}')).toBeNull();
  });
});

describe('enEntryToImportEntries', () => {
  it('emits one entry per matching translation row, with the english word as the gloss', () => {
    const out = Array.from(
      enEntryToImportEntries(
        {
          word: 'book',
          pos: 'noun',
          translations: [
            { lang_code: 'hi', word: 'किताब', sense: 'a written work' },
            { lang_code: 'hi', word: 'पुस्तक', sense: 'a written work' },
            { lang_code: 'fr', word: 'livre' },
          ],
        },
        HI_OPTS,
      ),
    );
    expect(out).toHaveLength(2);
    expect(out[0]!.headword).toBe('किताब');
    expect(out[0]!.pos).toBe('NOUN');
    expect(out[0]!.glossDefault).toBe('book');
    expect(out[0]!.translations[0]!.body).toBe('book');
    expect(out[1]!.headword).toBe('पुस्तक');
  });

  it('synthesizes a stable source_id from headword + pos + sha1(en_word|sense)', () => {
    const a = Array.from(
      enEntryToImportEntries(
        {
          word: 'water',
          pos: 'noun',
          translations: [{ lang_code: 'hi', word: 'पानी', sense: 'a liquid' }],
        },
        HI_OPTS,
      ),
    );
    const b = Array.from(
      enEntryToImportEntries(
        {
          word: 'water',
          pos: 'noun',
          translations: [{ lang_code: 'hi', word: 'पानी', sense: 'a liquid' }],
        },
        HI_OPTS,
      ),
    );
    expect(a[0]!.sourceId).toBe(b[0]!.sourceId);
    expect(a[0]!.sourceId).toMatch(/^kaikki-en:hi:पानी:NOUN:[0-9a-f]{12}$/);
  });

  it('treats a sense edit as a fresh row (different source_id)', () => {
    const a = Array.from(
      enEntryToImportEntries(
        {
          word: 'water',
          pos: 'noun',
          translations: [{ lang_code: 'hi', word: 'पानी', sense: 'a liquid' }],
        },
        HI_OPTS,
      ),
    );
    const b = Array.from(
      enEntryToImportEntries(
        {
          word: 'water',
          pos: 'noun',
          translations: [{ lang_code: 'hi', word: 'पानी', sense: 'a liquid (revised)' }],
        },
        HI_OPTS,
      ),
    );
    expect(a[0]!.sourceId).not.toBe(b[0]!.sourceId);
  });

  it('handles a missing sense gracefully (still emits)', () => {
    const out = Array.from(
      enEntryToImportEntries(
        {
          word: 'water',
          pos: 'noun',
          translations: [{ lang_code: 'hi', word: 'पानी' }],
        },
        HI_OPTS,
      ),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.glossDefault).toBe('water');
  });

  it('skips translations of other languages', () => {
    const out = Array.from(
      enEntryToImportEntries(
        {
          word: 'book',
          pos: 'noun',
          translations: [
            { lang_code: 'fr', word: 'livre' },
            { lang_code: 'de', word: 'Buch' },
            { lang_code: 'es', word: 'libro' },
          ],
        },
        HI_OPTS,
      ),
    );
    expect(out).toEqual([]);
  });

  it('skips entries with unimportable POS (phrase, prefix, abbreviation, ...)', () => {
    const out = Array.from(
      enEntryToImportEntries(
        {
          word: 'cut and run',
          pos: 'phrase',
          translations: [{ lang_code: 'hi', word: 'भाग जाना' }],
        },
        HI_OPTS,
      ),
    );
    expect(out).toEqual([]);
  });

  it('skips translations with empty headword after NFC + trim', () => {
    const out = Array.from(
      enEntryToImportEntries(
        {
          word: 'book',
          pos: 'noun',
          translations: [
            { lang_code: 'hi', word: '   ' },
            { lang_code: 'hi', word: '', sense: 'placeholder' },
          ],
        },
        HI_OPTS,
      ),
    );
    expect(out).toEqual([]);
  });

  it('respects the sourceIdPrefix from options (multi-language)', () => {
    const out = Array.from(
      enEntryToImportEntries(
        {
          word: 'water',
          pos: 'noun',
          translations: [{ lang_code: 'or', word: 'ପାଣି' }],
        },
        { targetLang: 'or', script: 'Orya', sourceIdPrefix: 'kaikki-en:or' },
      ),
    );
    expect(out[0]!.sourceId).toMatch(/^kaikki-en:or:ପାଣି:NOUN:[0-9a-f]{12}$/);
    expect(out[0]!.script).toBe('Orya');
  });
});

describe('streaming over the fixture', () => {
  beforeEach(() => {
    process.env.KAIKKI_EN_TRANSLATIONS_FILE = FIXTURE;
  });
  afterEach(() => {
    delete process.env.KAIKKI_EN_TRANSLATIONS_FILE;
  });

  it('Hindi importer yields exactly the Hindi target rows (no other languages, no phrases)', async () => {
    const out: ImportEntry[] = [];
    for await (const e of await kaikkiEnTranslationsHindiSource.entries()) {
      out.push(e);
    }
    expect(out.map((e) => `${e.headword}/${e.pos}=${e.glossDefault}`).sort()).toEqual(
      [
        // book → किताब, पुस्तक
        'किताब/NOUN=book',
        'पुस्तक/NOUN=book',
        // water → पानी, जल
        'जल/NOUN=water',
        'पानी/NOUN=water',
        // to read → पढ़ना
        'पढ़ना/VERB=to read',
        // hello → नमस्ते, हैलो
        'नमस्ते/INTJ=hello',
        'हैलो/INTJ=hello',
      ].sort(),
    );
  });

  it('Marathi importer yields exactly the Marathi target rows', async () => {
    const out: ImportEntry[] = [];
    for await (const e of await kaikkiEnTranslationsMarathiSource.entries()) {
      out.push(e);
    }
    expect(out.map((e) => `${e.headword}/${e.pos}=${e.glossDefault}`).sort()).toEqual(
      [
        'पाणी/NOUN=water',
        'पुस्तक/NOUN=book',
        'वाचणे/VERB=to read',
      ].sort(),
    );
    expect(kaikkiEnTranslationsMarathiSource.language).toBe('mr');
  });

  it('Odia importer yields Odia rows with the Orya script identifier', async () => {
    const out: ImportEntry[] = [];
    for await (const e of await kaikkiEnTranslationsOdiaSource.entries()) {
      out.push(e);
    }
    expect(out.map((e) => `${e.headword}/${e.pos}=${e.glossDefault}`).sort()).toEqual(
      ['ବହି/NOUN=book', 'ପଢ଼ିବା/VERB=to read', 'ପାଣି/NOUN=water'].sort(),
    );
    for (const e of out) {
      expect(e.script).toBe('Orya');
      expect(e.sourceId.startsWith('kaikki-en:or:')).toBe(true);
    }
  });

  it('exposes the expected metadata + license on each language source', () => {
    for (const src of [
      kaikkiEnTranslationsHindiSource,
      kaikkiEnTranslationsMarathiSource,
      kaikkiEnTranslationsOdiaSource,
    ]) {
      expect(src.license).toBe('CC-BY-SA-3.0');
      expect(src.sourceAttribution).toContain('Wiktionary');
      expect(src.sourceAttribution).toContain('Translations');
    }
  });
});
