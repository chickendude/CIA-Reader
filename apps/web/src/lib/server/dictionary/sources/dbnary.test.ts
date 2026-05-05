// @vitest-environment node
/**
 * Dbnary importer + Turtle parser tests (T-3.10b).
 *
 * Covers the hand-rolled scanner against fixture Turtle and the entry
 * assembler against the lemon/ontolex predicates Dbnary actually
 * publishes. No new deps, no live network, no real bz2 decompression.
 */
import { describe, expect, it } from 'vitest';

import {
  buildImportEntry,
  handleTriple,
  mapDbnaryPos,
  parseTurtle,
  tokenize,
  type DbnarySourceOptions,
} from './dbnary.js';
import { dbnaryHindiSource } from './dbnary-hi.js';

const HINDI_OPTS: DbnarySourceOptions = {
  name: 'dbnary-hi',
  language: 'hi',
  script: 'Deva',
  sourceIdPrefix: 'dbnary:hi',
  attribution: 'Dbnary Hindi',
  license: 'CC-BY-SA-3.0',
  envVar: 'DBNARY_HINDI_FILE',
  defaultPath: 'data/dictionaries/dbnary-hi/raw.ttl',
  headwordLang: 'hi',
  translationLang: 'en',
};

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

function lines(s: string): string[] {
  return s.split('\n');
}

describe('mapDbnaryPos', () => {
  it('maps lexinfo POS IRIs to UD tags', () => {
    expect(mapDbnaryPos('http://www.lexinfo.net/ontology/2.0/lexinfo#noun')).toBe('NOUN');
    expect(mapDbnaryPos('http://www.lexinfo.net/ontology/2.0/lexinfo#verb')).toBe('VERB');
    expect(mapDbnaryPos('http://www.lexinfo.net/ontology/2.0/lexinfo#adjective')).toBe('ADJ');
  });

  it('returns null for unmapped POS (phrase, prefix, …)', () => {
    expect(mapDbnaryPos('http://www.lexinfo.net/ontology/2.0/lexinfo#phrase')).toBeNull();
    expect(mapDbnaryPos('http://www.lexinfo.net/ontology/2.0/lexinfo#suffix')).toBeNull();
  });
});

describe('tokenize', () => {
  it('splits IRIs, prefixed names, and language-tagged literals', () => {
    expect(tokenize('<http://x/a> rdfs:label "हिन्दी"@hi')).toEqual([
      '<http://x/a>',
      'rdfs:label',
      '"हिन्दी"@hi',
    ]);
  });

  it('handles strings with escaped quotes', () => {
    expect(tokenize('<x> rdfs:label "with \\"quotes\\""@en')).toEqual([
      '<x>',
      'rdfs:label',
      '"with \\"quotes\\""@en',
    ]);
  });

  it('treats `a` as a standalone token (rdf:type alias)', () => {
    expect(tokenize('<x> a ontolex:LexicalEntry')).toEqual([
      '<x>',
      'a',
      'ontolex:LexicalEntry',
    ]);
  });
});

describe('parseTurtle', () => {
  it('resolves prefixed names against @prefix declarations', async () => {
    const triples = await collect(
      parseTurtle(
        lines(
          [
            '@prefix ex: <http://example.org/> .',
            '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
            'ex:foo rdfs:label "foo"@en .',
          ].join('\n'),
        ),
      ),
    );
    expect(triples).toEqual([
      {
        subject: 'http://example.org/foo',
        predicate: 'http://www.w3.org/2000/01/rdf-schema#label',
        object: { kind: 'literal', value: 'foo', lang: 'en' },
      },
    ]);
  });

  it('expands `;`-continued statements onto the same subject', async () => {
    const turtle = [
      '@prefix ex: <http://example.org/> .',
      '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
      '@prefix lexinfo: <http://www.lexinfo.net/ontology/2.0/lexinfo#> .',
      'ex:lemma a <http://www.w3.org/ns/lemon/ontolex#LexicalEntry> ;',
      '    rdfs:label "test"@en ;',
      '    lexinfo:partOfSpeech lexinfo:noun .',
    ].join('\n');
    const triples = await collect(parseTurtle(lines(turtle)));
    expect(triples).toHaveLength(3);
    for (const t of triples) {
      expect(t.subject).toBe('http://example.org/lemma');
    }
  });

  it('strips inline `#` comments outside string literals', async () => {
    const triples = await collect(
      parseTurtle(
        lines(
          [
            '@prefix ex: <http://example.org/> .',
            'ex:a <http://x/p> "value"@en . # trailing comment',
          ].join('\n'),
        ),
      ),
    );
    expect(triples).toHaveLength(1);
    expect(triples[0]!.object).toEqual({ kind: 'literal', value: 'value', lang: 'en' });
  });

  it('drops literals whose lang tag does not match the requested headword lang', async () => {
    // The parser yields the triple regardless of language; the
    // entry assembler is the language gate. This test fixes the
    // contract: parsing is permissive, assembly is strict.
    const triples = await collect(
      parseTurtle(
        lines(
          [
            '@prefix ex: <http://example.org/> .',
            '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
            'ex:a rdfs:label "foreign"@de .',
          ].join('\n'),
        ),
      ),
    );
    expect(triples).toHaveLength(1);
    expect(triples[0]!.object).toEqual({ kind: 'literal', value: 'foreign', lang: 'de' });
  });
});

describe('handleTriple → buildImportEntry', () => {
  function assemble(turtle: string) {
    return collectImportEntries(turtle, HINDI_OPTS);
  }

  it('emits an ImportEntry per LexicalEntry with definition translations', async () => {
    const turtle = [
      '@prefix ex: <http://example.org/> .',
      '@prefix ontolex: <http://www.w3.org/ns/lemon/ontolex#> .',
      '@prefix lexinfo: <http://www.lexinfo.net/ontology/2.0/lexinfo#> .',
      '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
      '@prefix skos: <http://www.w3.org/2004/02/skos/core#> .',
      '',
      'ex:लाइब्रेरी__noun a ontolex:LexicalEntry ;',
      '    rdfs:label "लाइब्रेरी"@hi ;',
      '    lexinfo:partOfSpeech lexinfo:noun ;',
      '    ontolex:sense ex:लाइब्रेरी__noun__sense__1 .',
      '',
      'ex:लाइब्रेरी__noun__sense__1 skos:definition "library"@en .',
    ].join('\n');
    const entries = await assemble(turtle);
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry!.headword).toBe('लाइब्रेरी');
    expect(entry!.pos).toBe('NOUN');
    expect(entry!.script).toBe('Deva');
    expect(entry!.translations).toHaveLength(1);
    expect(entry!.translations[0]!.body).toBe('library');
    expect(entry!.glossDefault).toBe('library');
  });

  it('prefers ontolex:writtenRep on the canonicalForm over rdfs:label', async () => {
    const turtle = [
      '@prefix ex: <http://example.org/> .',
      '@prefix ontolex: <http://www.w3.org/ns/lemon/ontolex#> .',
      '@prefix lexinfo: <http://www.lexinfo.net/ontology/2.0/lexinfo#> .',
      '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
      '@prefix skos: <http://www.w3.org/2004/02/skos/core#> .',
      '',
      'ex:e a ontolex:LexicalEntry ;',
      '    rdfs:label "fallback"@hi ;',
      '    lexinfo:partOfSpeech lexinfo:noun ;',
      '    ontolex:canonicalForm ex:e_form ;',
      '    ontolex:sense ex:e_sense .',
      '',
      'ex:e_form ontolex:writtenRep "preferred"@hi .',
      'ex:e_sense skos:definition "definition"@en .',
    ].join('\n');
    const [entry] = await assemble(turtle);
    expect(entry!.headword).toBe('preferred');
  });

  it('drops entries without a hi-tagged headword', async () => {
    const turtle = [
      '@prefix ex: <http://example.org/> .',
      '@prefix ontolex: <http://www.w3.org/ns/lemon/ontolex#> .',
      '@prefix lexinfo: <http://www.lexinfo.net/ontology/2.0/lexinfo#> .',
      '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
      '',
      'ex:foreign a ontolex:LexicalEntry ;',
      '    rdfs:label "german"@de ;',
      '    lexinfo:partOfSpeech lexinfo:noun .',
    ].join('\n');
    expect(await assemble(turtle)).toHaveLength(0);
  });

  it('drops entries with no sense definitions in the requested language', async () => {
    const turtle = [
      '@prefix ex: <http://example.org/> .',
      '@prefix ontolex: <http://www.w3.org/ns/lemon/ontolex#> .',
      '@prefix lexinfo: <http://www.lexinfo.net/ontology/2.0/lexinfo#> .',
      '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
      '@prefix skos: <http://www.w3.org/2004/02/skos/core#> .',
      '',
      'ex:e a ontolex:LexicalEntry ;',
      '    rdfs:label "हिन्दी"@hi ;',
      '    lexinfo:partOfSpeech lexinfo:noun ;',
      '    ontolex:sense ex:e_sense .',
      '',
      'ex:e_sense skos:definition "Definition"@de .',
    ].join('\n');
    expect(await assemble(turtle)).toHaveLength(0);
  });

  it('drops POS Dbnary lists outside the supported map (e.g. phrase)', async () => {
    const turtle = [
      '@prefix ex: <http://example.org/> .',
      '@prefix ontolex: <http://www.w3.org/ns/lemon/ontolex#> .',
      '@prefix lexinfo: <http://www.lexinfo.net/ontology/2.0/lexinfo#> .',
      '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
      '@prefix skos: <http://www.w3.org/2004/02/skos/core#> .',
      '',
      'ex:p a ontolex:LexicalEntry ;',
      '    rdfs:label "मेरा नाम"@hi ;',
      '    lexinfo:partOfSpeech lexinfo:phrase ;',
      '    ontolex:sense ex:p_sense .',
      '',
      'ex:p_sense skos:definition "my name"@en .',
    ].join('\n');
    expect(await assemble(turtle)).toHaveLength(0);
  });

  it('emits a stable sourceId so re-imports update the same row', async () => {
    const turtle = [
      '@prefix ex: <http://example.org/> .',
      '@prefix ontolex: <http://www.w3.org/ns/lemon/ontolex#> .',
      '@prefix lexinfo: <http://www.lexinfo.net/ontology/2.0/lexinfo#> .',
      '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
      '@prefix skos: <http://www.w3.org/2004/02/skos/core#> .',
      '',
      'ex:stable a ontolex:LexicalEntry ;',
      '    rdfs:label "किताब"@hi ;',
      '    lexinfo:partOfSpeech lexinfo:noun ;',
      '    ontolex:sense ex:stable_s1 .',
      '',
      'ex:stable_s1 skos:definition "book"@en .',
    ].join('\n');
    const a = await assemble(turtle);
    const b = await assemble(turtle);
    expect(a[0]!.sourceId).toBe(b[0]!.sourceId);
    expect(a[0]!.sourceId).toMatch(/^dbnary:hi:[0-9a-f]{12}$/);
    expect(a[0]!.translations[0]!.sourceId).toMatch(/^dbnary:hi:sense:[0-9a-f]{12}:0$/);
  });

  it('deduplicates identical definitions across senses', async () => {
    const turtle = [
      '@prefix ex: <http://example.org/> .',
      '@prefix ontolex: <http://www.w3.org/ns/lemon/ontolex#> .',
      '@prefix lexinfo: <http://www.lexinfo.net/ontology/2.0/lexinfo#> .',
      '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
      '@prefix skos: <http://www.w3.org/2004/02/skos/core#> .',
      '',
      'ex:dup a ontolex:LexicalEntry ;',
      '    rdfs:label "घर"@hi ;',
      '    lexinfo:partOfSpeech lexinfo:noun ;',
      '    ontolex:sense ex:dup_s1 ;',
      '    ontolex:sense ex:dup_s2 .',
      '',
      'ex:dup_s1 skos:definition "home"@en .',
      'ex:dup_s2 skos:definition "home"@en .',
    ].join('\n');
    const [entry] = await assemble(turtle);
    expect(entry!.translations).toHaveLength(1);
    expect(entry!.translations[0]!.body).toBe('home');
  });
});

describe('dbnaryHindiSource registry shape', () => {
  it('exposes the expected attribution + license', () => {
    expect(dbnaryHindiSource.name).toBe('dbnary-hi');
    expect(dbnaryHindiSource.language).toBe('hi');
    expect(dbnaryHindiSource.license).toBe('CC-BY-SA-3.0');
    expect(dbnaryHindiSource.sourceAttribution).toContain('GETALP');
  });
});

async function collectImportEntries(
  turtle: string,
  opts: DbnarySourceOptions,
): Promise<ReturnType<typeof buildImportEntry>[]> {
  const entries = new Map();
  const forms = new Map();
  const senses = new Map();
  for await (const triple of parseTurtle(lines(turtle))) {
    handleTriple(triple, entries, forms, senses, opts);
  }
  const out: ReturnType<typeof buildImportEntry>[] = [];
  for (const e of entries.values()) {
    const built = buildImportEntry(e, forms, senses, opts);
    if (built) out.push(built);
  }
  return out;
}
