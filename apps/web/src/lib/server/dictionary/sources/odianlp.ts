/**
 * OdiaNLP curated subset importer (T-3.10g).
 *
 * The OdiaNLP umbrella covers multiple community-maintained Odia
 * dictionaries with mixed licenses (MIT, CC-BY, occasional unclear
 * cases). To make per-entry provenance visible without proliferating
 * one importer per upstream resource, the curated subset is collected
 * into a single JSONL file under
 * `apps/web/data/dictionaries/odianlp/curated.jsonl`. Each line is
 * one entry in this shape:
 *
 *     {
 *       "id": "<stable upstream id>",
 *       "headword": "ବହି",
 *       "pos": "noun",
 *       "definitions": ["book"],
 *       "publisher": "OdiaNLP / <contributor>",
 *       "license": "MIT" | "CC-BY-4.0" | "CC-BY-3.0" | "CC0-1.0"
 *     }
 *
 * License gating: the curator running the import classifies every
 * entry's license at acquisition time — the importer's job is to
 * refuse to silently import anything that didn't pass that check.
 * Unknown / missing license values raise `OdiaNlpLicenseError` and
 * stop the run, so a contaminated file can't poison the database.
 *
 * Per-entry license is recorded on each lemma's
 * `source_attribution` ("OdiaNLP / <publisher> (<license>)") so the
 * credits page can group by license bucket without us building a new
 * column.
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { LanguageCode } from '@ciareader/shared-types';

import type { DictionaryImportSource, ImportEntry } from '../types.js';

export type OdiaNlpRow = {
  id: string;
  headword: string;
  pos: string;
  definitions: string[];
  publisher: string;
  license: string;
};

export class OdiaNlpLicenseError extends Error {
  constructor(public readonly entryId: string, public readonly license: string) {
    super(
      `OdiaNLP entry ${entryId} carries an unrecognized license: "${license}". ` +
        `Add it to the allowlist in odianlp.ts after a curator/legal review.`,
    );
    this.name = 'OdiaNlpLicenseError';
  }
}

export const ODIANLP_ALLOWED_LICENSES = new Set<string>([
  'MIT',
  'CC0-1.0',
  'CC-BY-3.0',
  'CC-BY-4.0',
  'CC-BY-SA-3.0',
  'CC-BY-SA-4.0',
  'PublicDomain',
]);

const POS_MAP: Record<string, string> = {
  noun: 'NOUN',
  verb: 'VERB',
  adjective: 'ADJ',
  adverb: 'ADV',
  pronoun: 'PRON',
  conjunction: 'CCONJ',
  preposition: 'ADP',
  postposition: 'ADP',
  interjection: 'INTJ',
  numeral: 'NUM',
  particle: 'PART',
  determiner: 'DET',
};

export function mapOdiaNlpPos(raw: string): string | null {
  return POS_MAP[raw.trim().toLowerCase()] ?? null;
}

/**
 * Parse one JSONL line. Returns null for blank or comment lines, and
 * throws (`OdiaNlpLicenseError`) if the line is well-formed but
 * carries a license outside the allowlist — failing loud is the
 * point.
 */
export function parseOdiaNlpLine(line: string): OdiaNlpRow | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) return null;
  const obj = JSON.parse(trimmed) as Partial<OdiaNlpRow>;
  if (typeof obj.headword !== 'string' || obj.headword.length === 0) return null;
  if (typeof obj.pos !== 'string') return null;
  const definitions = Array.isArray(obj.definitions)
    ? obj.definitions.filter((d): d is string => typeof d === 'string' && d.trim().length > 0)
    : [];
  if (definitions.length === 0) return null;

  const license = (obj.license ?? '').trim();
  const id = (obj.id ?? '').trim();
  if (!ODIANLP_ALLOWED_LICENSES.has(license)) {
    throw new OdiaNlpLicenseError(id || obj.headword, license);
  }
  return {
    id: id || obj.headword,
    headword: obj.headword,
    pos: obj.pos,
    definitions,
    publisher: (obj.publisher ?? 'OdiaNLP').trim(),
    license,
  };
}

export function rowToImportEntry(row: OdiaNlpRow): ImportEntry | null {
  const pos = mapOdiaNlpPos(row.pos);
  if (!pos) return null;
  const headword = row.headword.normalize('NFC').trim();
  if (!headword) return null;

  const sourceId = `odianlp:${row.id}`;
  const attribution = `${row.publisher} (${row.license})`;
  return {
    sourceId,
    headword,
    pos,
    script: 'Orya',
    glossDefault: row.definitions[0]!,
    translations: row.definitions.map((body, i) => ({
      sourceId: `${sourceId}:def:${i}`,
      body,
      // Per-entry attribution overrides the source's default,
      // so the credits page can group rows by their actual
      // upstream license bucket.
      sourceAttribution: attribution,
    })),
  };
}

async function* streamOdiaNlpSource(filePath: string): AsyncIterable<ImportEntry> {
  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const row = parseOdiaNlpLine(line);
    if (!row) continue;
    const entry = rowToImportEntry(row);
    if (entry) yield entry;
  }
}

function resolvePath(): string {
  const fromEnv = process.env.ODIANLP_FILE;
  if (fromEnv) return fromEnv;
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '../../../../../', 'data/dictionaries/odianlp/curated.jsonl');
}

export const odiaNlpSource: DictionaryImportSource = {
  name: 'odianlp',
  language: 'or' as LanguageCode,
  // Default attribution for entries that don't carry their own
  // override — the runner falls back to this when the per-entry
  // sourceAttribution is absent. In practice every OdiaNLP row
  // ships its own attribution string.
  sourceAttribution: 'OdiaNLP curated subset (mixed licenses; see per-entry attribution)',
  license: 'Mixed-Curated',
  entries: () => streamOdiaNlpSource(resolvePath()),
};
