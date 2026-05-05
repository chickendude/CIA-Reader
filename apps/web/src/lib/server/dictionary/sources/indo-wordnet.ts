/**
 * Shared CFILT IndoWordNet importer factory (T-3.10a/c, anticipating
 * T-3.10f).
 *
 * CFILT IIT-Bombay distributes monolingual WordNets for every Indian
 * language under a research-use license, all in the same TSV format:
 *
 *     <synset_id>\t<category>\t<concept>\t<example>\t<words>\n
 *
 *   - `synset_id`: stable id, the same one the language's webhwn-style
 *     browser shows.
 *   - `category`: lowercase noun / verb / adjective / adverb. Anything
 *     else (idioms, named-entity bundles, …) drops the row.
 *   - `concept`: the synset definition, used as `gloss_default` and as
 *     the body of the (single) translation row. The dump is
 *     monolingual — the gloss is in the same language as the
 *     headwords, so the translation row is tagged with the source's
 *     own `language`. A future ticket can cross-link with English
 *     WordNet via the synset id to surface en translations.
 *   - `example`: usage example. Dropped at MVP.
 *   - `words`: comma- or semicolon-separated members of the synset.
 *     Each unique (word, POS) tuple becomes its own `ImportEntry` so
 *     the lemma table stays normalized; the synset stays linkable
 *     through `source_id` (`<prefix>:<synset_id>:<word_idx>`).
 *
 * Distribution requires registration with CFILT, so the fetch script
 * leaves the artifact as a manual placement; the importer's
 * `defaultPath` points at where the operator should drop it.
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { LanguageCode } from '@ciareader/shared-types';

import type { DictionaryImportSource, ImportEntry } from '../types.js';

export type SynsetRow = {
  synsetId: string;
  category: string;
  concept: string;
  example: string;
  words: string[];
};

const POS_MAP: Record<string, string> = {
  noun: 'NOUN',
  verb: 'VERB',
  adjective: 'ADJ',
  adverb: 'ADV',
  // CFILT releases occasionally include `pronoun` and `particle` rows.
  // Keep the door open without advertising support for tags upstream
  // hasn't given us yet.
  pronoun: 'PRON',
  particle: 'PART',
};

export function mapWordNetPos(category: string): string | null {
  return POS_MAP[category.trim().toLowerCase()] ?? null;
}

/**
 * Parse one TSV line. Returns null for blank, comment, or malformed
 * rows so the runner can drop them without throwing — research-use
 * dumps occasionally ship with a banner / licence header.
 */
export function parseSynsetLine(line: string): SynsetRow | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const fields = line.split('\t');
  if (fields.length < 5) return null;
  const [synsetId, category, concept, example, words] = fields;
  if (!synsetId || !category || !words) return null;
  const wordList = words
    .split(/[,;]/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
  if (wordList.length === 0) return null;
  return {
    synsetId: synsetId.trim(),
    category: category.trim(),
    concept: (concept ?? '').trim(),
    example: (example ?? '').trim(),
    words: wordList,
  };
}

export type IndoWordNetSourceOptions = {
  /** Stable name (e.g. 'hindi-wordnet'). Drives CLI selection. */
  name: string;
  language: LanguageCode;
  /** ISO 15924 code: Deva (Devanagari), Orya (Odia), … */
  script: string;
  /** Prefix for synthesized source_ids, e.g. 'hwn' for Hindi. */
  sourceIdPrefix: string;
  attribution: string;
  license: string;
  /** Env var that overrides the default file path (used by tests). */
  envVar: string;
  /**
   * Default file path relative to the apps/web root, e.g.
   * 'data/dictionaries/hindi-wordnet/synsets.tsv'. Distribution is
   * gated by CFILT registration, so the file is placed manually.
   */
  defaultPath: string;
};

export function synsetRowToEntries(
  row: SynsetRow,
  opts: Pick<IndoWordNetSourceOptions, 'script' | 'sourceIdPrefix' | 'language'>,
): ImportEntry[] {
  const pos = mapWordNetPos(row.category);
  if (!pos) return [];
  if (!row.concept) return [];
  const out: ImportEntry[] = [];
  const seen = new Set<string>();
  let idx = 0;
  for (const raw of row.words) {
    const headword = raw.normalize('NFC').trim();
    if (!headword || seen.has(headword)) continue;
    seen.add(headword);
    const sourceId = `${opts.sourceIdPrefix}:${row.synsetId}:${idx}`;
    out.push({
      sourceId,
      headword,
      pos,
      script: opts.script,
      glossDefault: row.concept,
      translations: [
        {
          sourceId: `${sourceId}:concept`,
          // Monolingual dump — the gloss is in the source language,
          // not English. Tag accordingly so the curator UI doesn't
          // surface a Hindi/Marathi/Odia gloss as an English row.
          targetLanguage: opts.language,
          body: row.concept,
        },
      ],
    });
    idx += 1;
  }
  return out;
}

async function* streamSynsetSource(
  filePath: string,
  opts: IndoWordNetSourceOptions,
): AsyncIterable<ImportEntry> {
  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const row = parseSynsetLine(line);
    if (!row) continue;
    for (const entry of synsetRowToEntries(row, opts)) yield entry;
  }
}

function resolvePath(opts: IndoWordNetSourceOptions): string {
  const fromEnv = process.env[opts.envVar];
  if (fromEnv) return fromEnv;
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '../../../../../', opts.defaultPath);
}

export function makeIndoWordNetSource(
  opts: IndoWordNetSourceOptions,
): DictionaryImportSource {
  return {
    name: opts.name,
    language: opts.language,
    sourceAttribution: opts.attribution,
    license: opts.license,
    entries: () => streamSynsetSource(resolvePath(opts), opts),
  };
}
