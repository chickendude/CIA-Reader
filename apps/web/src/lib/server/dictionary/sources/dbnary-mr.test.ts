// @vitest-environment node
/**
 * Smoke test for the Dbnary Marathi instantiation (T-3.10e).
 *
 * The shared parser is exhaustively covered in `dbnary.test.ts`; this
 * file just locks in the language-specific knobs (lang tag, attribution,
 * sourceId prefix) so a future refactor that breaks `dbnary-mr` doesn't
 * silently keep `dbnary-hi`'s assertions green.
 */
import { describe, expect, it } from 'vitest';

import {
  buildImportEntry,
  handleTriple,
  parseTurtle,
  type DbnarySourceOptions,
} from './dbnary.js';
import { dbnaryMarathiSource } from './dbnary-mr.js';

const MARATHI_OPTS: DbnarySourceOptions = {
  name: 'dbnary-mr',
  language: 'mr',
  script: 'Deva',
  sourceIdPrefix: 'dbnary:mr',
  attribution: 'Dbnary Marathi',
  license: 'CC-BY-SA-3.0',
  envVar: 'DBNARY_MARATHI_FILE',
  defaultPath: 'data/dictionaries/dbnary-mr/raw.ttl',
  headwordLang: 'mr',
  translationLang: 'en',
};

describe('dbnaryMarathiSource registry shape', () => {
  it('exposes the expected attribution + license + language', () => {
    expect(dbnaryMarathiSource.name).toBe('dbnary-mr');
    expect(dbnaryMarathiSource.language).toBe('mr');
    expect(dbnaryMarathiSource.license).toBe('CC-BY-SA-3.0');
    expect(dbnaryMarathiSource.sourceAttribution).toContain('GETALP');
    expect(dbnaryMarathiSource.sourceAttribution).toContain('Marathi');
  });
});

describe('Marathi-language gating', () => {
  it('keeps mr-tagged headwords and drops hi-tagged ones', async () => {
    const turtle = [
      '@prefix ex: <http://example.org/> .',
      '@prefix ontolex: <http://www.w3.org/ns/lemon/ontolex#> .',
      '@prefix lexinfo: <http://www.lexinfo.net/ontology/2.0/lexinfo#> .',
      '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
      '@prefix skos: <http://www.w3.org/2004/02/skos/core#> .',
      '',
      'ex:mr_entry a ontolex:LexicalEntry ;',
      '    rdfs:label "पुस्तक"@mr ;',
      '    lexinfo:partOfSpeech lexinfo:noun ;',
      '    ontolex:sense ex:mr_sense .',
      '',
      'ex:mr_sense skos:definition "book"@en .',
      '',
      'ex:hi_entry a ontolex:LexicalEntry ;',
      '    rdfs:label "किताब"@hi ;',
      '    lexinfo:partOfSpeech lexinfo:noun ;',
      '    ontolex:sense ex:hi_sense .',
      '',
      'ex:hi_sense skos:definition "book"@en .',
    ].join('\n');

    const entries = new Map();
    const forms = new Map();
    const senses = new Map();
    for await (const triple of parseTurtle(turtle.split('\n'))) {
      handleTriple(triple, entries, forms, senses, MARATHI_OPTS);
    }
    const built = [...entries.values()]
      .map((e) => buildImportEntry(e, forms, senses, MARATHI_OPTS))
      .filter(Boolean);

    expect(built).toHaveLength(1);
    expect(built[0]!.headword).toBe('पुस्तक');
    expect(built[0]!.sourceId).toMatch(/^dbnary:mr:[0-9a-f]{12}$/);
  });
});
