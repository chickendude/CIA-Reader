/**
 * Generic DSAL → CIA Reader importer factory.
 *
 * Consumes the normalized JSONL that `pnpm dsal:parse <slug>` writes
 * (see ../dsal/records.ts) and yields `ImportEntry` values, mirroring
 * how `makeKaikkiSource` wraps Kaikki dumps. Each dictionary gets a
 * thin `makeDsalSource({...})` instantiation in `dsal-<name>.ts`.
 *
 * Stable upstream identity — print-artifact key, not gloss hash:
 *   dsal:<dict>:<raw headword>:<page>:<ord>
 * (ord = homograph ordinal among same headword + page). Unlike
 * Wiktionary, a DSAL digitization is static — the only upstream text
 * changes are DSAL-side OCR corrections, which we WANT to update the
 * same row in place rather than fork a merge candidate. Keying on the
 * 19th/20th-century print artifact also survives re-scrapes and any
 * future orthographic-normalizer change (the id uses the RAW scraped
 * headword; the normalized form goes on the lemma), so enabling a
 * curator fixup table later never orphans rows. Entries whose page ref
 * is missing fall back to a sense-hash key.
 *
 * This supersedes the unmerged `feat/t-3.10d-molesworth` TEI importer
 * (commit 3ef786e) — the TEI XML dump it targeted was never obtainable.
 * Carried over from that branch: the `OrthographicNormalizer` seam
 * (NFC-only default; the curator-reviewed archaic-spelling fixup table
 * remains a follow-up that plugs in here) and the raw-headword
 * source_id philosophy.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { LanguageCode } from '@ciareader/shared-types';

import type { DsalRecord } from '../dsal/records.js';
import { parseDsalRecordLine } from '../dsal/records.js';
import type { DictionaryImportSource, ImportEntry, TranslationPayload } from '../types.js';

export interface OrthographicNormalizer {
  /** Map an archaic printed spelling onto the modern form. */
  toModern(spelling: string): string;
}

/**
 * NFC-only normalizer — the safe default. A curator-reviewed
 * archaic-spelling table (chandrabindu placement, anusvara vs. nasal
 * vowel, …) replaces this per dictionary once it's signed off.
 */
export const NFC_ONLY_NORMALIZER: OrthographicNormalizer = {
  toModern(spelling: string): string {
    return spelling.normalize('NFC').trim();
  },
};

/**
 * POS map for the two Marathi dictionaries. Molesworth and Vaze mark
 * nouns by GENDER — `m`/`f`/`n` mean masculine/feminine/neuter noun
 * (विज्ञान `n` is a neuter noun, ऋग्वेद `m` a masculine one) — with
 * `c` for common/dual gender; `a` adjective, `ad` adverb, `v` verb
 * (plus `v i`/`v t`/`v c` valency compounds, handled by first-token
 * cleanup in `mapDsalPos`).
 */
export const MARATHI_POS_MAP: Record<string, string> = {
  m: 'NOUN',
  f: 'NOUN',
  n: 'NOUN',
  c: 'NOUN',
  a: 'ADJ',
  ad: 'ADV',
  v: 'VERB',
  pron: 'PRON',
  prep: 'ADP',
  postp: 'ADP',
  conj: 'CCONJ',
  interj: 'INTJ',
  intj: 'INTJ',
  num: 'NUM',
  part: 'PART',
};

/**
 * POS map for Platts (1884). Platts marks substantives with gendered
 * abbreviations (`s.m.` / `s.f.`) and verbs by valency (`v.n.` neuter
 * i.e. intransitive, `v.t.` transitive). `mapDsalPos` strips trailing
 * dots, so keys are dot-less at the end but keep internal dots.
 */
export const PLATTS_POS_MAP: Record<string, string> = {
  's.m': 'NOUN',
  's.f': 'NOUN',
  adj: 'ADJ',
  adv: 'ADV',
  'v.n': 'VERB',
  'v.t': 'VERB',
  intj: 'INTJ',
  interj: 'INTJ',
  prep: 'ADP',
  postpn: 'ADP',
  pron: 'PRON',
  conj: 'CCONJ',
  part: 'PART',
};

/**
 * Map a raw printed POS marker through a per-dictionary table: try the
 * whole marker, then its first token (`v i` → `v`), lowercased and
 * with trailing dots dropped. Returns null when unrecognized — the
 * caller falls back to UD `X` rather than dropping the entry, because
 * a dictionary entry with an odd grammar marker is still a real entry
 * and the reader's headword-only fallback tier still matches it.
 */
export function mapDsalPos(posRaw: string | undefined, posMap: Record<string, string>): string | null {
  if (!posRaw) return null;
  const cleaned = posRaw.trim().toLowerCase().replace(/\.+$/, '');
  if (posMap[cleaned]) return posMap[cleaned];
  const first = cleaned.split(/\s+/)[0]?.replace(/\.+$/, '') ?? '';
  return posMap[first] ?? null;
}

/**
 * First sense trimmed to a tooltip-sized gloss at a word boundary.
 * Molesworth first senses run to paragraphs; the full text stays in
 * the translation body.
 */
export function trimGloss(body: string, maxLength = 160): string {
  const text = body.trim();
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 40 ? lastSpace : maxLength).trimEnd()}…`;
}

export type DsalSourceOptions = {
  /** Registry name, e.g. 'dsal-molesworth' — also the data-dir slug. */
  name: string;
  language: LanguageCode;
  /** ISO 15924 code of the imported headwords. */
  script: string;
  attribution: string;
  license: string;
  /** Raw printed POS marker → UD tag. Unmapped markers become 'X'. */
  posMap: Record<string, string>;
  /**
   * Full override for POS resolution when table lookup + first-token
   * cleanup doesn't fit the dictionary's marker shape (Praharaj embeds
   * the POS abbreviation after an etymology prefix, e.g. `ସଂ. ବି. (…)`).
   * Wins over `posMap` when provided.
   */
  mapPos?: (posRaw: string | undefined) => string | null;
  /**
   * Per-sense definition language (ISO 639-1) — Praharaj glosses mix
   * English and Odia. Omit for all-English dictionaries (the runner
   * defaults `targetLanguage` to 'en').
   */
  glossLanguageFor?: (senseBody: string) => string | undefined;
  normalizer?: OrthographicNormalizer;
  /** Env var overriding the JSONL path (tests point it at a fixture). */
  envVar: string;
  /** Default path relative to apps/web, e.g. 'data/dictionaries/dsal-molesworth/raw.jsonl'. */
  defaultPath: string;
};

/** `dsal-molesworth` → `molesworth` (source_id segment). */
function dictKey(name: string): string {
  return name.replace(/^dsal-/, '');
}

export function dsalSourceId(name: string, rec: DsalRecord): string {
  const dict = dictKey(name);
  if (rec.page !== undefined) {
    return `dsal:${dict}:${rec.hw}:${rec.page}:${rec.ord}`;
  }
  const hash = createHash('sha1').update(rec.senses.join('||')).digest('hex').slice(0, 12);
  return `dsal:${dict}:${rec.hw}:h${hash}:${rec.ord}`;
}

export function dsalRecordToImportEntry(
  rec: DsalRecord,
  opts: Pick<
    DsalSourceOptions,
    'name' | 'script' | 'posMap' | 'mapPos' | 'glossLanguageFor' | 'normalizer'
  >,
): ImportEntry | null {
  const normalizer = opts.normalizer ?? NFC_ONLY_NORMALIZER;
  const headword = normalizer.toModern(rec.hw);
  if (!headword) return null;

  const sourceId = dsalSourceId(opts.name, rec);
  const translations: TranslationPayload[] = [];
  for (let i = 0; i < rec.senses.length; i += 1) {
    const body = rec.senses[i]!.trim();
    if (!body) continue;
    const translation: TranslationPayload = { sourceId: `${sourceId}:s${i}`, body };
    const glossLanguage = opts.glossLanguageFor?.(body);
    if (glossLanguage) translation.targetLanguage = glossLanguage;
    translations.push(translation);
  }
  if (translations.length === 0) return null;

  return {
    sourceId,
    headword,
    pos: (opts.mapPos ? opts.mapPos(rec.posRaw) : mapDsalPos(rec.posRaw, opts.posMap)) ?? 'X',
    script: opts.script,
    glossDefault: trimGloss(translations[0]!.body),
    translations,
    // No forms: the scraped alternates (Perso-Arabic spellings, roman
    // transliterations) would pollute native-script surface matching.
  };
}

async function* streamDsalSource(
  filePath: string,
  opts: Pick<
    DsalSourceOptions,
    'name' | 'script' | 'posMap' | 'mapPos' | 'glossLanguageFor' | 'normalizer'
  >,
): AsyncIterable<ImportEntry> {
  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const rec = parseDsalRecordLine(line);
    if (!rec) continue;
    const entry = dsalRecordToImportEntry(rec, opts);
    if (entry) yield entry;
  }
}

function resolvePath(opts: DsalSourceOptions): string {
  const fromEnv = process.env[opts.envVar];
  if (fromEnv) return fromEnv;
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '../../../../../', opts.defaultPath);
}

export function makeDsalSource(opts: DsalSourceOptions): DictionaryImportSource {
  return {
    name: opts.name,
    language: opts.language,
    sourceAttribution: opts.attribution,
    license: opts.license,
    entries: () => streamDsalSource(resolvePath(opts), opts),
  };
}
