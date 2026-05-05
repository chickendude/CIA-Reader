// @vitest-environment node
/**
 * Molesworth (DSAL) importer tests (T-3.10d).
 *
 * Fixture-based — verifies the entry-block scanner, tag extraction,
 * POS map, and ImportEntry assembly. The production normalizer table
 * (mapping archaic 1857 spellings to modern Marathi) is curator-
 * gated; the tests use `NFC_ONLY_NORMALIZER` so a future curator-
 * approved table doesn't have to update fixtures.
 */
import { describe, expect, it } from 'vitest';

import {
  entryToImportEntry,
  extractAllTagText,
  extractTagText,
  mapMolesworthPos,
  molesworthSource,
  NFC_ONLY_NORMALIZER,
  parseEntry,
  streamEntryBlocks,
  type OrthographicNormalizer,
} from './molesworth.js';

async function* asChunks(s: string, size = 16): AsyncIterable<string> {
  for (let i = 0; i < s.length; i += size) yield s.slice(i, i + size);
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

describe('mapMolesworthPos', () => {
  it('maps Latin abbreviations onto UD POS tags', () => {
    expect(mapMolesworthPos('n')).toBe('NOUN');
    expect(mapMolesworthPos('v')).toBe('VERB');
    expect(mapMolesworthPos('a')).toBe('ADJ');
    expect(mapMolesworthPos('ad')).toBe('ADV');
  });

  it('takes the first whitespace-separated token (handles "n c"-style compound tags)', () => {
    expect(mapMolesworthPos('n c')).toBe('NOUN');
  });

  it('returns null for unmapped tags', () => {
    expect(mapMolesworthPos('idiom')).toBeNull();
    expect(mapMolesworthPos('')).toBeNull();
  });
});

describe('streamEntryBlocks', () => {
  it('yields each <entry>...</entry> block from a chunked stream', async () => {
    const xml = `
      <TEI>
        <body>
          <entry id="a"><form><orth>क</orth></form></entry>
          <entry id="b"><form><orth>ख</orth></form></entry>
        </body>
      </TEI>
    `;
    const blocks = await collect(streamEntryBlocks(asChunks(xml, 13)));
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain('id="a"');
    expect(blocks[1]).toContain('id="b"');
  });

  it('reassembles an entry split across chunk boundaries', async () => {
    const entry = '<entry id="x"><form><orth>headword</orth></form><sense><def>gloss</def></sense></entry>';
    const blocks = await collect(streamEntryBlocks(asChunks(entry, 7)));
    expect(blocks).toEqual([entry]);
  });
});

describe('extractTagText / extractAllTagText', () => {
  it('returns inner text of the first matching tag, stripping inner markup', () => {
    expect(extractTagText('<def>foo <i>bar</i> baz</def>', 'def')).toBe('foo bar baz');
  });

  it('returns null when the tag is absent', () => {
    expect(extractTagText('<entry></entry>', 'def')).toBeNull();
  });

  it('decodes HTML entities', () => {
    expect(extractTagText('<def>a &amp; b</def>', 'def')).toBe('a & b');
  });

  it('returns every match in document order', () => {
    expect(extractAllTagText('<def>a</def><def>b</def><def>c</def>', 'def')).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});

describe('parseEntry', () => {
  it('extracts the orth, pos, definitions, and id', () => {
    const entry = `
      <entry id="m_001">
        <form><orth>पुस्तक</orth></form>
        <gramGrp><pos>n</pos></gramGrp>
        <sense><def>book, volume</def></sense>
      </entry>
    `;
    const parsed = parseEntry(entry);
    expect(parsed).toEqual({
      id: 'm_001',
      rawHeadword: 'पुस्तक',
      pos: 'n',
      definitions: ['book, volume'],
    });
  });

  it('handles xml:id when id is absent', () => {
    const entry = `<entry xml:id="m_002"><form><orth>क</orth></form><sense><def>x</def></sense></entry>`;
    expect(parseEntry(entry)?.id).toBe('m_002');
  });

  it('returns null when the entry has no orth', () => {
    expect(parseEntry('<entry><sense><def>x</def></sense></entry>')).toBeNull();
  });

  it('keeps every <def> in document order', () => {
    const entry = `
      <entry id="m_003">
        <form><orth>घर</orth></form>
        <gramGrp><pos>n</pos></gramGrp>
        <sense><def>house</def></sense>
        <sense><def>home</def></sense>
        <sense><def>building</def></sense>
      </entry>
    `;
    expect(parseEntry(entry)?.definitions).toEqual(['house', 'home', 'building']);
  });
});

describe('entryToImportEntry', () => {
  it('builds an ImportEntry with one translation per definition', () => {
    const entry = entryToImportEntry(
      {
        id: 'm_001',
        rawHeadword: 'पुस्तक',
        pos: 'n',
        definitions: ['book', 'volume'],
      },
      NFC_ONLY_NORMALIZER,
    );
    expect(entry).not.toBeNull();
    expect(entry!.headword).toBe('पुस्तक');
    expect(entry!.pos).toBe('NOUN');
    expect(entry!.script).toBe('Deva');
    expect(entry!.sourceId).toBe('molesworth:m_001');
    expect(entry!.translations.map((t) => t.body)).toEqual(['book', 'volume']);
    expect(entry!.glossDefault).toBe('book');
  });

  it('falls back to the raw headword when xml:id is absent', () => {
    const entry = entryToImportEntry(
      { id: '', rawHeadword: 'घर', pos: 'n', definitions: ['house'] },
      NFC_ONLY_NORMALIZER,
    );
    expect(entry!.sourceId).toBe('molesworth:घर');
  });

  it('drops entries with unmapped POS or empty definitions', () => {
    expect(
      entryToImportEntry(
        { id: 'i', rawHeadword: 'x', pos: 'idiom', definitions: ['x'] },
        NFC_ONLY_NORMALIZER,
      ),
    ).toBeNull();
    expect(
      entryToImportEntry(
        { id: 'i', rawHeadword: 'x', pos: 'n', definitions: [] },
        NFC_ONLY_NORMALIZER,
      ),
    ).toBeNull();
  });

  it('runs the headword through the normalizer; sourceId stays anchored to the raw spelling', () => {
    // The custom normalizer maps an archaic spelling to a modern one
    // — the lemma row records the modern form, but the source_id
    // stays anchored to the archaic spelling so re-imports still
    // upsert the same row.
    const archaicToModern: OrthographicNormalizer = {
      toModern(s) {
        return s === 'पुस्‍तक' ? 'पुस्तक' : s.normalize('NFC');
      },
    };
    const entry = entryToImportEntry(
      {
        id: '',
        rawHeadword: 'पुस्‍तक',
        pos: 'n',
        definitions: ['book'],
      },
      archaicToModern,
    );
    expect(entry!.headword).toBe('पुस्तक');
    expect(entry!.sourceId).toBe('molesworth:पुस्‍तक');
  });
});

describe('molesworthSource registry shape', () => {
  it('exposes the expected attribution and license', () => {
    expect(molesworthSource.name).toBe('molesworth');
    expect(molesworthSource.language).toBe('mr');
    expect(molesworthSource.license).toBe('PublicDomain');
    expect(molesworthSource.sourceAttribution).toContain('Molesworth');
    expect(molesworthSource.sourceAttribution).toContain('DSAL');
  });
});
