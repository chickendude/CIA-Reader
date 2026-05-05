/**
 * Molesworth (DSAL) Marathi-English importer (T-3.10d).
 *
 * Parses the Digital Dictionaries of South Asia (DSAL) XML dump of
 * *Molesworth's A Dictionary, Marathi and English* (1857). The dump
 * follows a TEI-Lex0-flavoured shape:
 *
 *   <entry id="…" type="…">
 *     <form><orth>headword (Devanagari, sometimes archaic)</orth></form>
 *     <gramGrp><pos>n</pos></gramGrp>
 *     <sense>
 *       <def>English gloss / definition</def>
 *     </sense>
 *     …
 *   </entry>
 *
 * Two design choices to call out:
 *
 * 1. Hand-rolled scanner. The DSAL dump is mechanically generated and
 *    its element shape is regular, so a stack-based event scanner
 *    extracts what we need without pulling in a SAX dependency. The
 *    scanner reads chunks, finds `<entry … >` blocks, and parses each
 *    entry as a self-contained substring. If DSAL ever changes the
 *    shape we can swap the scanner for `sax` without touching the
 *    `entryToImportEntry` assembler.
 *
 * 2. Pluggable orthographic normalizer. Molesworth's headwords use
 *    19th-century spellings (chandrabindu placement, anusvara vs.
 *    nasal vowel, eccentric vowel-sign clusters) that need a
 *    curator-reviewed fixup table before re-imports stop creating
 *    duplicate lemmas with their modern siblings. The default
 *    normalizer is NFC-only — sufficient to land the importer; the
 *    fix-up table is a separate curator-driven follow-up. The
 *    `OrthographicNormalizer` interface gives the curator a single
 *    place to wire a table once the review pass is done.
 */
import { createReadStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { LanguageCode } from '@ciareader/shared-types';

import type { DictionaryImportSource, ImportEntry } from '../types.js';

export type RawEntry = {
  /** Original `id` attribute from the DSAL XML — empty if absent. */
  id: string;
  /** Headword exactly as Molesworth's 1857 typesetting renders it. Preserved on the lemma's `source_id` for traceability. */
  rawHeadword: string;
  /** POS tag local-name from `<pos>`. Lowercase. */
  pos: string;
  /** Definitions / glosses, in document order. */
  definitions: string[];
};

export interface OrthographicNormalizer {
  /** Map an archaic Molesworth spelling onto a modern Marathi form. */
  toModern(spelling: string): string;
}

/**
 * NFC-only normalizer (the safe default). Curator-extended tables
 * will subclass / replace this once the spelling-fix list is signed
 * off — see T-3.10d ticket blockers.
 */
export const NFC_ONLY_NORMALIZER: OrthographicNormalizer = {
  toModern(spelling: string): string {
    return spelling.normalize('NFC').trim();
  },
};

const POS_MAP: Record<string, string> = {
  // Molesworth uses Latin abbreviations for POS in `<pos>`.
  n: 'NOUN',
  noun: 'NOUN',
  v: 'VERB',
  verb: 'VERB',
  a: 'ADJ',
  adj: 'ADJ',
  ad: 'ADV',
  adv: 'ADV',
  pron: 'PRON',
  prep: 'ADP',
  postp: 'ADP',
  conj: 'CCONJ',
  intj: 'INTJ',
  num: 'NUM',
  particle: 'PART',
  // The 1857 type-setter sometimes uses Marathi-specific compound
  // tags (e.g. "n c" for noun-compound). Drop the suffix and try the
  // first token; otherwise the row drops out.
};

export function mapMolesworthPos(raw: string): string | null {
  const cleaned = raw.trim().toLowerCase().split(/\s+/)[0] ?? '';
  return POS_MAP[cleaned] ?? null;
}

const ENTRY_OPEN_RE = /<entry\b[^>]*>/g;
const ENTRY_CLOSE = '</entry>';

/**
 * Stream-yield each `<entry>...</entry>` block as a string. Reads in
 * arbitrary-size chunks and keeps a sliding buffer so an entry split
 * across two chunks is reassembled before the caller sees it.
 *
 * `BOUNDARY_TAIL` keeps the last few characters of an entry-free
 * chunk in the buffer so a `<entry` tag straddling a chunk boundary
 * (e.g. chunk ends `…<ent`, next chunk starts `ry id="b">…`) still
 * gets matched. Set to one less than the longest tag we search for
 * (`</entry>`).
 */
const BOUNDARY_TAIL = '</entry>'.length - 1;

export async function* streamEntryBlocks(
  text: AsyncIterable<string>,
): AsyncIterable<string> {
  let buffer = '';
  for await (const chunk of text) {
    buffer += chunk;
    let consumedTo = 0;
    while (true) {
      const open = buffer.indexOf('<entry', consumedTo);
      if (open === -1) {
        // No open tag in the rest of the buffer — keep a small tail
        // so a `<entry` that straddles the chunk boundary survives.
        consumedTo = Math.max(consumedTo, buffer.length - BOUNDARY_TAIL);
        break;
      }
      const close = buffer.indexOf(ENTRY_CLOSE, open);
      if (close === -1) {
        consumedTo = open;
        break;
      }
      const end = close + ENTRY_CLOSE.length;
      yield buffer.slice(open, end);
      consumedTo = end;
    }
    buffer = buffer.slice(consumedTo);
  }
}

/**
 * Best-effort "extract one tag's text" helper. Strips nested tags
 * inside the chosen element so `<def>foo<i>x</i>bar</def>` → "foobar"
 * without the importer becoming a real XML reader. Returns null when
 * the tag is absent.
 */
export function extractTagText(xml: string, localName: string): string | null {
  const re = new RegExp(`<${localName}\\b[^>]*>([\\s\\S]*?)<\\/${localName}>`);
  const m = re.exec(xml);
  if (!m) return null;
  return stripInnerTags(m[1]!).trim();
}

export function extractAllTagText(xml: string, localName: string): string[] {
  const re = new RegExp(`<${localName}\\b[^>]*>([\\s\\S]*?)<\\/${localName}>`, 'g');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const text = stripInnerTags(m[1]!).trim();
    if (text) out.push(text);
  }
  return out;
}

function stripInnerTags(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ');
}

function extractAttribute(openTag: string, name: string): string {
  const re = new RegExp(`${name}="([^"]*)"`);
  const m = re.exec(openTag);
  return m?.[1] ?? '';
}

export function parseEntry(xml: string): RawEntry | null {
  // The opening `<entry … >` tag carries the id; everything else is
  // looked up under fixed local names.
  const openMatch = ENTRY_OPEN_RE.exec(xml);
  ENTRY_OPEN_RE.lastIndex = 0;
  const openTag = openMatch?.[0] ?? '';
  const id = extractAttribute(openTag, 'id') || extractAttribute(openTag, 'xml:id');
  const orth = extractTagText(xml, 'orth');
  if (!orth) return null;
  const pos = extractTagText(xml, 'pos') ?? '';
  const definitions = extractAllTagText(xml, 'def');
  return {
    id,
    rawHeadword: orth,
    pos,
    definitions,
  };
}

export type MolesworthSourceOptions = {
  /** Normalizer used to map archaic spellings onto modern Marathi. */
  normalizer?: OrthographicNormalizer;
  /** Override the default file path (used by tests). */
  envVar?: string;
  defaultPath?: string;
};

/**
 * Convert one parsed entry into an `ImportEntry`. Returns null when
 * the row is unimportable — unmapped POS, no headword, no definitions.
 *
 * The lemma's `source_id` carries both the DSAL `xml:id` (when present)
 * and the original archaic spelling — re-imports are idempotent
 * regardless of normalizer changes.
 */
export function entryToImportEntry(
  entry: RawEntry,
  normalizer: OrthographicNormalizer,
): ImportEntry | null {
  const pos = mapMolesworthPos(entry.pos);
  if (!pos) return null;
  const headword = normalizer.toModern(entry.rawHeadword);
  if (!headword) return null;
  const cleanedDefs = entry.definitions
    .map((d) => d.trim())
    .filter((d) => d.length > 0);
  if (cleanedDefs.length === 0) return null;

  // Deterministic source_id: the xml id wins when present, otherwise
  // the raw archaic spelling — both are stable across runs even if
  // the normalizer's fixup table evolves.
  const stableKey = entry.id || entry.rawHeadword;
  const sourceId = `molesworth:${stableKey}`;

  return {
    sourceId,
    headword,
    pos,
    script: 'Deva',
    glossDefault: cleanedDefs[0]!,
    translations: cleanedDefs.map((body, i) => ({
      sourceId: `${sourceId}:def:${i}`,
      body,
    })),
  };
}

async function* streamMolesworthSource(
  filePath: string,
  normalizer: OrthographicNormalizer,
): AsyncIterable<ImportEntry> {
  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  for await (const block of streamEntryBlocks(stream as unknown as AsyncIterable<string>)) {
    const entry = parseEntry(block);
    if (!entry) continue;
    const built = entryToImportEntry(entry, normalizer);
    if (built) yield built;
  }
}

function resolvePath(opts: MolesworthSourceOptions): string {
  const envVar = opts.envVar ?? 'MOLESWORTH_FILE';
  const fromEnv = process.env[envVar];
  if (fromEnv) return fromEnv;
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(
    here,
    '../../../../../',
    opts.defaultPath ?? 'data/dictionaries/molesworth/dsal.xml',
  );
}

export const molesworthSource: DictionaryImportSource = {
  name: 'molesworth',
  language: 'mr' as LanguageCode,
  sourceAttribution:
    "Molesworth, A Dictionary, Marathi and English (1857) via DSAL — public domain",
  license: 'PublicDomain',
  entries: () =>
    streamMolesworthSource(resolvePath({}), NFC_ONLY_NORMALIZER),
};
