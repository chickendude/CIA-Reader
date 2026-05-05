/**
 * Hindi WordNet (CFILT IIT-Bombay) importer (T-3.10a).
 *
 * CFILT distributes Hindi WordNet under a research-use license; the
 * publicly-circulated dump is a tab-separated synset-per-line format:
 *
 *     <synset_id>\t<category>\t<concept>\t<example>\t<words>\n
 *
 *   - `synset_id`: stable 5-7 digit id, the same id `webhwn` shows.
 *   - `category`: lowercase noun / verb / adjective / adverb. Anything
 *     else (idioms, named-entity bundles, …) drops the row.
 *   - `concept`: the synset definition, used as the lemma's
 *     `gloss_default` and the body of the (single) translation row
 *     since the dump is monolingual Hindi.
 *   - `example`: usage example, dropped at MVP (we keep the data model
 *     focused on lemma + translation; example sentences land separately
 *     in a future ticket).
 *   - `words`: comma-separated members of the synset. Each unique
 *     (word, POS) tuple becomes its own `ImportEntry` so the lemma
 *     table stays normalized; the synset stays linkable through
 *     `source_id` (`hwn:<synset_id>:<word_idx>`).
 *
 * CFILT may require registration to obtain the dump; the fetch script
 * (currently `dbnary-*` and `kaikki-*` aware) leaves this importer's
 * artifact as a manual placement at
 * `data/dictionaries/hindi-wordnet/synsets.tsv`. The importer reads
 * whatever's there — re-running with a fresh dump updates the same
 * lemma rows because `source_id` is stable per (synset_id, word_idx).
 *
 * Lines starting with `#` are skipped so a downloaded dump can carry
 * a banner or licence text without choking the parser.
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { LanguageCode } from '@ciareader/shared-types';

import type { DictionaryImportSource, ImportEntry } from '../types.js';

export type HwnRow = {
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
  // Hindi WordNet ships a small "particle" / "pronoun" set in some
  // releases. Keep the door open without advertising support
  // upstream changes haven't given us yet.
  pronoun: 'PRON',
  particle: 'PART',
};

export function mapWordNetPos(category: string): string | null {
  return POS_MAP[category.trim().toLowerCase()] ?? null;
}

/**
 * Parse one TSV line. Returns null for blank, comment, or malformed
 * rows — the runner drops nulls. We deliberately don't throw on
 * malformed rows so a partially-corrupted dump still imports the
 * rows it can read.
 */
export function parseHwnLine(line: string): HwnRow | null {
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

/**
 * Convert one TSV row into one or more `ImportEntry` values — one per
 * unique word in the synset. Returns an empty array when the row has
 * no usable members (unknown POS, no concept, etc.).
 */
export function hwnRowToEntries(row: HwnRow): ImportEntry[] {
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
    const sourceId = `hwn:${row.synsetId}:${idx}`;
    out.push({
      sourceId,
      headword,
      pos,
      script: 'Deva',
      glossDefault: row.concept,
      translations: [
        {
          sourceId: `${sourceId}:concept`,
          // The dump is monolingual Hindi — `concept` is a Hindi
          // definition, not an English translation. Mark the
          // translation row as Hindi-target so the curator UI
          // doesn't surface it as an English gloss. Future tickets
          // can cross-link with English WordNet via the synset id
          // for an en translation.
          targetLanguage: 'hi',
          body: row.concept,
        },
      ],
    });
    idx += 1;
  }
  return out;
}

async function* streamHwnSource(filePath: string): AsyncIterable<ImportEntry> {
  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const row = parseHwnLine(line);
    if (!row) continue;
    for (const entry of hwnRowToEntries(row)) yield entry;
  }
}

function resolvePath(): string {
  const fromEnv = process.env.HINDI_WORDNET_FILE;
  if (fromEnv) return fromEnv;
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '../../../../../', 'data/dictionaries/hindi-wordnet/synsets.tsv');
}

export const hindiWordnetSource: DictionaryImportSource = {
  name: 'hindi-wordnet',
  language: 'hi' as LanguageCode,
  sourceAttribution:
    'Hindi WordNet, CFILT IIT-Bombay (research use; attribution required)',
  license: 'Custom-Research-Use',
  entries: () => streamHwnSource(resolvePath()),
};
