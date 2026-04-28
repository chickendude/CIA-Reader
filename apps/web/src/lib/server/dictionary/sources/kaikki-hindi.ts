/**
 * Kaikki Hindi → CIA Reader importer (T-3.10).
 *
 * Reads a Kaikki.org Wiktionary JSONL dump for Hindi, one JSON object
 * per line. Each line is one (word, POS, etymology) entry from
 * Wiktionary; we yield one `ImportEntry` per line. Multiple Kaikki
 * lines may share `(word, pos)` (different etymologies of the same
 * word) — they become separate lemma rows by design (T-3.10's
 * `lemmas_language_headword_pos_uq` was dropped specifically to allow
 * per-source duplication, which curators reconcile via T-3.7's merge UI).
 *
 * The dump is NOT committed to the repo. Run the fetch step first:
 *
 *   pnpm dictionary:fetch kaikki-hindi
 *
 * which downloads it to `data/dictionaries/kaikki-hindi/raw.jsonl`.
 * Tests inject a fixture via the `KAIKKI_HINDI_FILE` env var so the
 * importer doesn't hit the network in CI.
 *
 * Stable upstream identity: synthesize `source_id` as
 * `kaikki:hi:<word>:<pos>:<sha1(joined glosses)[..12]>` so re-imports
 * find and update the same row when nothing changed, but treat a
 * Wiktionary edit that changes the gloss text as a fresh entity (which
 * is correct — a new row gets inserted; the old one ages out as
 * curators decide whether to merge them in).
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DictionaryImportSource, ImportEntry } from '../types.js';

export type KaikkiSense = {
  glosses?: string[];
  raw_glosses?: string[];
  english?: string[];
  tags?: string[];
};

export type KaikkiEntry = {
  word: string;
  pos: string;
  lang_code?: string;
  senses?: KaikkiSense[];
  forms?: Array<{ form: string; tags?: string[] }>;
};

/**
 * Parse one JSONL line. Returns null for blank lines, malformed JSON,
 * or rows missing the required `word`/`pos` fields. Caller filters
 * nulls; we never throw on a bad line because Kaikki dumps occasionally
 * include non-JSON debug rows that we don't want to crash the import.
 */
export function parseKaikkiLine(line: string): KaikkiEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed) as Partial<KaikkiEntry>;
    if (typeof obj.word !== 'string' || typeof obj.pos !== 'string') return null;
    return obj as KaikkiEntry;
  } catch {
    return null;
  }
}

/**
 * Map Kaikki/Wiktionary POS strings onto UD-style POS tags the rest of
 * the codebase already uses. Returns null for entries we don't want to
 * import as lemmas at all (phrases, prefixes, abbreviations, etc.).
 */
const POS_MAP: Record<string, string> = {
  noun: 'NOUN',
  verb: 'VERB',
  adj: 'ADJ',
  adv: 'ADV',
  pron: 'PRON',
  conj: 'CCONJ',
  prep: 'ADP',
  postp: 'ADP',
  intj: 'INTJ',
  num: 'NUM',
  particle: 'PART',
  det: 'DET',
  name: 'PROPN',
  proper_noun: 'PROPN',
  // Deliberately omitted: phrase, prefix, suffix, infix, abbreviation,
  // character, romanization, idiom — those don't belong in a lemma
  // table at MVP scope.
};

export function mapKaikkiPos(pos: string): string | null {
  return POS_MAP[pos.toLowerCase()] ?? null;
}

function glossesOf(sense: KaikkiSense): string[] {
  return sense.glosses ?? sense.raw_glosses ?? sense.english ?? [];
}

function hashGlosses(senses: KaikkiSense[]): string {
  const joined = senses
    .flatMap(glossesOf)
    .map((g) => g.trim())
    .filter(Boolean)
    .join('||');
  return createHash('sha1').update(joined).digest('hex').slice(0, 12);
}

/**
 * Convert one Kaikki entry into the importer's canonical shape. Returns
 * null when the row is unimportable — unknown POS, no usable glosses,
 * empty headword.
 */
export function kaikkiToImportEntry(raw: KaikkiEntry): ImportEntry | null {
  const pos = mapKaikkiPos(raw.pos);
  if (!pos) return null;
  const headword = raw.word.normalize('NFC').trim();
  if (!headword) return null;
  const senses = raw.senses ?? [];
  if (senses.length === 0) return null;

  const glossHash = hashGlosses(senses);
  const sourceId = `kaikki:hi:${headword}:${pos}:${glossHash}`;

  const translations: Array<{ sourceId: string; body: string }> = [];
  for (let i = 0; i < senses.length; i += 1) {
    const sense = senses[i] as KaikkiSense;
    const body = glossesOf(sense)
      .map((g) => g.trim())
      .filter(Boolean)
      .join('; ');
    if (!body) continue;
    translations.push({ sourceId: `${sourceId}:s${i}`, body });
  }
  if (translations.length === 0) return null;

  const glossDefault = translations[0]!.body;

  // Kaikki's per-form `tags` are freeform strings ("plural", "direct",
  // "honorific") that don't map onto UD-style FEATS without a manual
  // conversion table. For MVP we keep the surface form so it's
  // discoverable in fallback lookups but leave `features` empty —
  // curators or the NLP pipeline can fill them in later.
  const forms = (raw.forms ?? [])
    .filter((f) => typeof f.form === 'string' && f.form.length > 0)
    .map((f) => f.form.normalize('NFC'))
    .filter((surface) => surface !== headword)
    .map((surface) => ({ surface, features: {} as Record<string, string> }));

  const entry: ImportEntry = {
    sourceId,
    headword,
    pos,
    script: 'Deva',
    glossDefault,
    translations,
  };
  if (forms.length > 0) entry.forms = forms;
  return entry;
}

async function* streamKaikkiHindi(filePath: string): AsyncIterable<ImportEntry> {
  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const raw = parseKaikkiLine(line);
    if (!raw) continue;
    const entry = kaikkiToImportEntry(raw);
    if (entry) yield entry;
  }
}

/**
 * Resolve the path to the JSONL artifact. Tests set
 * `KAIKKI_HINDI_FILE`; production reads the canonical
 * `apps/web/data/dictionaries/kaikki-hindi/raw.jsonl` (gitignored).
 */
function resolveKaikkiPath(): string {
  if (process.env.KAIKKI_HINDI_FILE) return process.env.KAIKKI_HINDI_FILE;
  // From .../src/lib/server/dictionary/sources/ up to apps/web/, then
  // into data/dictionaries/kaikki-hindi/raw.jsonl.
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '../../../../../data/dictionaries/kaikki-hindi/raw.jsonl');
}

export const kaikkiHindiSource: DictionaryImportSource = {
  name: 'kaikki-hindi',
  language: 'hi',
  sourceAttribution: 'Wiktionary Hindi via Kaikki.org',
  license: 'CC-BY-SA-3.0',
  entries: () => streamKaikkiHindi(resolveKaikkiPath()),
};
