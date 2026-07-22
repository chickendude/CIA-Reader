// @vitest-environment node
/**
 * Parser tests against REAL scraped DSAL responses (fixtures captured
 * 2026-07-22 from the live query CGI, one narrow query per dictionary).
 * If DSAL redesigns its results markup these break loudly — that is
 * the point; re-capture fixtures and adjust the parser.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DSAL_DICTIONARIES, DSAL_SLUGS, findDsalConfig } from './config.js';
import {
  htmlToText,
  parseDeclaredResultCount,
  parseDsalResultsHtml,
  splitNumberedSenses,
} from './parse.js';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const read = (name: string): string => readFileSync(resolve(FIXTURES, name), 'utf-8');

describe('findDsalConfig', () => {
  it('resolves every registered slug and rejects unknowns', () => {
    for (const slug of DSAL_SLUGS) {
      expect(findDsalConfig(slug)?.slug).toBe(slug);
    }
    expect(findDsalConfig('dsal-nope')).toBeUndefined();
  });
});

describe('htmlToText', () => {
  it('strips tags, decodes entities, collapses whitespace', () => {
    expect(htmlToText('<b>a</b> &amp; <i>b</i>&nbsp;&nbsp;c')).toBe('a & b c');
  });

  it('decodes numeric entities', () => {
    expect(htmlToText('&#2325;')).toBe('क');
  });
});

describe('parseDeclaredResultCount', () => {
  it('reads singular and plural counts', () => {
    expect(parseDeclaredResultCount('<div>1 result</div>')).toBe(1);
    expect(parseDeclaredResultCount('<div>1,234 results</div>')).toBe(1234);
  });

  it('returns null when the page declares nothing', () => {
    expect(parseDeclaredResultCount('<div>hello</div>')).toBeNull();
  });
});

describe('splitNumberedSenses', () => {
  it('splits an ascending run starting at 2', () => {
    expect(splitNumberedSenses('First sense. 2 Second sense. 3 Third.')).toEqual([
      'First sense.',
      'Second sense.',
      'Third.',
    ]);
  });

  it('keeps non-sequential numbers inside the text', () => {
    expect(splitNumberedSenses('Born in 1857 near 12 villages.')).toEqual([
      'Born in 1857 near 12 villages.',
    ]);
  });

  it('returns a single sense when there are no numbers', () => {
    expect(splitNumberedSenses('Knowledge, science.')).toEqual(['Knowledge, science.']);
  });
});

describe('parseDsalResultsHtml — Molesworth', () => {
  const outcome = parseDsalResultsHtml(read('molesworth-results.html'), DSAL_DICTIONARIES['dsal-molesworth']);

  it('parses the entry with headword, transliteration, POS, and page', () => {
    expect(outcome.stats).toMatchObject({ blocks: 1, parsed: 1, declaredResults: 1 });
    const rec = outcome.records[0]!;
    expect(rec.slug).toBe('dsal-molesworth');
    expect(rec.hw).toBe('विज्ञान');
    expect(rec.translit).toBe('vijñāna');
    expect(rec.posRaw).toBe('n');
    expect(rec.page).toBe(767);
  });

  it('splits prose senses at ascending inline numbers and strips the etymology letter', () => {
    const rec = outcome.records[0]!;
    expect(rec.senses).toHaveLength(4);
    expect(rec.senses[0]).toMatch(/^Knowledge, science, learning/);
    expect(rec.senses[1]).toMatch(/^Knowledge of; acquaintance with/);
    expect(rec.senses[3]).toContain('Knowledge of God or Truth');
    // The Marathi example inside <d>…</d> stays part of the sense body.
    expect(rec.senses[3]).toContain('ऐसा जो झाला');
  });
});

describe('parseDsalResultsHtml — Vaze', () => {
  it('parses the single-sense entry', () => {
    const outcome = parseDsalResultsHtml(read('vaze-results.html'), DSAL_DICTIONARIES['dsal-vaze']);
    expect(outcome.stats).toMatchObject({ blocks: 1, parsed: 1 });
    const rec = outcome.records[0]!;
    expect(rec.hw).toBe('विज्ञान');
    expect(rec.posRaw).toBe('n');
    expect(rec.page).toBe(509);
    expect(rec.senses).toEqual(['Knowledge, science. Experience.']);
  });
});

describe('parseDsalResultsHtml — Platts', () => {
  const outcome = parseDsalResultsHtml(read('platts-results.html'), DSAL_DICTIONARIES['dsal-platts']);

  it('skips entries with no Devanagari orthography and counts them', () => {
    // کمال kamāl carries only Perso-Arabic + roman — unmatchable by a
    // Devanagari reader, so it is skipped and reported.
    expect(outcome.stats).toMatchObject({ blocks: 2, parsed: 1, noDevanagari: 1, declaredResults: 2 });
  });

  it('extracts the Devanagari headword, Perso-Arabic alt, transliteration, and POS', () => {
    const rec = outcome.records[0]!;
    expect(rec.hw).toBe('कमल');
    expect(rec.hwAlt).toEqual(['کمل']);
    expect(rec.translit).toBe('kamal');
    expect(rec.posRaw).toBe('s.m.');
    expect(rec.page).toBe(849);
    expect(rec.senses).toHaveLength(1);
    expect(rec.senses[0]).toMatch(/^s\.m\. The lotus/);
    expect(rec.senses[0]).toContain('kamal-nāl');
  });
});

describe('parseDsalResultsHtml — Praharaj', () => {
  const outcome = parseDsalResultsHtml(read('praharaj-results.html'), DSAL_DICTIONARIES['dsal-praharaj']);

  it('parses headword, transliteration, and the gramGrp marker', () => {
    expect(outcome.stats).toMatchObject({ blocks: 1, parsed: 1 });
    const rec = outcome.records[0]!;
    expect(rec.hw).toBe('ଅଭିଧାନ');
    expect(rec.translit).toBe('Abhidhāna');
    expect(rec.posRaw).toBe('ସଂ. ବି. (ଅଭି+ଧା ଧାତୁ+ଭାବ. ଅନ)');
    expect(rec.page).toBe(495);
  });

  it('splits numbered new_p spans into senses and folds verse quotes into the preceding sense', () => {
    const rec = outcome.records[0]!;
    expect(rec.senses).toHaveLength(3);
    expect(rec.senses[0]).toContain('କଥନ');
    expect(rec.senses[0]).toContain('1. Speaking.');
    // Sense 2 carries its <verse> quotation appended, not a phantom 4th sense.
    expect(rec.senses[1]).toContain('2. Name.');
    expect(rec.senses[1]).toContain('ପୁତ୍ରଙ୍କର ଅଭିଧାନ');
    expect(rec.senses[2]).toContain('3. Vocabulary; dictionary; lexicon.');
  });

  it('keeps the Odia—English shape the importer language split relies on', () => {
    const rec = outcome.records[0]!;
    // Odia definition text before an em-dash, English gloss after.
    expect(rec.senses[2]).toMatch(/ଶବ୍ଦାର୍ଥକୋଷ.*—\s*3\. Vocabulary/);
  });
});

describe('parseDsalResultsHtml — comma-joined Marathi headwords', () => {
  it('splits alternates into hwAlt with the first form as the headword', () => {
    // Real shape from Vaze: entry head "खोरी, खोरें" (one entry, two
    // spellings). Reconstructed minimal block.
    const html =
      "<div class='container mb-3 rounded border shadow-sm py-3'>&nbsp;&nbsp;" +
      '1) <a href="/cgi-bin/app/vaze_query.py?qs=खोरी&searchhws=yes&matchtype=exact">खोरी, खोरें</a> khōrī' +
      ' (<a href="/cgi-bin/app/vaze_query.py?page=185">p. 185</a>)' +
      "<div class='px-4'><hw><b>खोरी, खोरें</b></hw> <i>f</i> A narrow valley.</span> </div></div>";
    const outcome = parseDsalResultsHtml(html, DSAL_DICTIONARIES['dsal-vaze']);
    expect(outcome.stats.parsed).toBe(1);
    const rec = outcome.records[0]!;
    expect(rec.hw).toBe('खोरी');
    expect(rec.hwAlt).toEqual(['खोरें']);
    expect(rec.posRaw).toBe('f');
    expect(rec.senses).toEqual(['A narrow valley.']);
  });
});

describe('parseDsalResultsHtml — resilience', () => {
  it('returns empty output for a page with no entry blocks', () => {
    const outcome = parseDsalResultsHtml('<html><body>No results</body></html>', DSAL_DICTIONARIES['dsal-molesworth']);
    expect(outcome.records).toEqual([]);
    expect(outcome.stats.blocks).toBe(0);
  });

  it('counts blocks whose headword anchor is missing', () => {
    const html = "<div class='container mb-3 rounded border shadow-sm py-3'><div class='px-4'>orphan</div></div>";
    const outcome = parseDsalResultsHtml(html, DSAL_DICTIONARIES['dsal-molesworth']);
    expect(outcome.stats).toMatchObject({ blocks: 1, parsed: 0, noHeadword: 1 });
  });
});
