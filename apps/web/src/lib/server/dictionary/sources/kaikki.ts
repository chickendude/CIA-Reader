/**
 * Generic Kaikki.org → CIA Reader importer factory (T-3.10).
 *
 * Kaikki publishes one JSONL dump per language; the per-line shape is
 * identical across languages, so the parser, POS map, gloss-hashing,
 * and stream wrapper all live here. Each language gets a one-line
 * `makeKaikkiSource({...})` instantiation in `kaikki-<lang>.ts`.
 *
 * Stable upstream identity: `<sourceIdPrefix>:<word>:<pos>:<sha1(joined glosses)[..12]>`.
 * Re-imports update the same row when content didn't change; a
 * Wiktionary edit that changes a gloss creates a fresh row that the
 * curator UI surfaces as a merge candidate.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { LanguageCode } from '@ciareader/shared-types';

import type { DictionaryImportSource, ImportEntry, TranslationPayload } from '../types.js';

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
 * or rows missing required `word`/`pos` fields. Caller filters nulls;
 * we never throw because Kaikki dumps occasionally include non-JSON
 * debug rows that we don't want to crash the import.
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
 * Map Kaikki/Wiktionary POS strings onto the UD-style POS tags the
 * rest of the codebase already uses. Returns null for entries we don't
 * import as lemmas (phrases, prefixes, abbreviations, ...).
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

export type KaikkiSourceOptions = {
  /** Stable name (e.g. 'kaikki-hindi'). Drives CLI selection. */
  name: string;
  language: LanguageCode;
  /** ISO 15924 code: Deva (Devanagari), Orya (Odia), etc. */
  script: string;
  /** Prefix for synthesized source_ids, e.g. 'kaikki:hi'. */
  sourceIdPrefix: string;
  attribution: string;
  license: string;
  /**
   * Definition language of the glosses in this dump (ISO 639-1), stamped
   * onto every emitted translation's `targetLanguage`. Different Kaikki
   * editions gloss the same headword in different languages — the English
   * Wiktionary glosses in English, the Spanish edition in Spanish. Omit
   * to let the runner default to `'en'`.
   */
  glossLanguage?: string;
  /** Env var that overrides the default file path (used by tests). */
  envVar: string;
  /**
   * Default file path relative to the apps/web root, e.g.
   * 'data/dictionaries/kaikki-hindi/raw.jsonl'. Production reads this
   * after the fetch script writes it; the file is gitignored.
   */
  defaultPath: string;
};

/**
 * Convert one Kaikki entry into the importer's canonical shape. Returns
 * null when the row is unimportable — unknown POS, no usable glosses,
 * empty headword.
 */
export function kaikkiToImportEntry(
  raw: KaikkiEntry,
  opts: Pick<KaikkiSourceOptions, 'script' | 'sourceIdPrefix' | 'glossLanguage'>,
): ImportEntry | null {
  const pos = mapKaikkiPos(raw.pos);
  if (!pos) return null;
  const headword = raw.word.normalize('NFC').trim();
  if (!headword) return null;
  const senses = raw.senses ?? [];
  if (senses.length === 0) return null;

  const glossHash = hashGlosses(senses);
  const sourceId = `${opts.sourceIdPrefix}:${headword}:${pos}:${glossHash}`;

  const translations: TranslationPayload[] = [];
  for (let i = 0; i < senses.length; i += 1) {
    const sense = senses[i] as KaikkiSense;
    const body = glossesOf(sense)
      .map((g) => g.trim())
      .filter(Boolean)
      .join('; ');
    if (!body) continue;
    const translation: TranslationPayload = { sourceId: `${sourceId}:s${i}`, body };
    if (opts.glossLanguage) translation.targetLanguage = opts.glossLanguage;
    translations.push(translation);
  }
  if (translations.length === 0) return null;

  const glossDefault = translations[0]!.body;

  // Kaikki's per-form `tags` are freeform strings ("plural", "direct",
  // "honorific") that don't map onto UD-style FEATS without a manual
  // conversion table. For MVP we keep the surface form so it's
  // discoverable in fallback lookups but leave `features` empty.
  const forms = (raw.forms ?? [])
    .filter((f) => typeof f.form === 'string' && f.form.length > 0)
    .map((f) => f.form.normalize('NFC'))
    .filter((surface) => surface !== headword)
    .map((surface) => ({ surface, features: {} as Record<string, string> }));

  const entry: ImportEntry = {
    sourceId,
    headword,
    pos,
    script: opts.script,
    glossDefault,
    translations,
  };
  if (forms.length > 0) entry.forms = forms;
  return entry;
}

async function* streamKaikkiSource(
  filePath: string,
  opts: Pick<KaikkiSourceOptions, 'script' | 'sourceIdPrefix' | 'glossLanguage'>,
): AsyncIterable<ImportEntry> {
  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const raw = parseKaikkiLine(line);
    if (!raw) continue;
    const entry = kaikkiToImportEntry(raw, opts);
    if (entry) yield entry;
  }
}

/**
 * Resolve the file path for a Kaikki source. Tests set the env var to
 * a fixture path; production reads the gitignored file under
 * `apps/web/data/dictionaries/...`.
 */
function resolvePath(opts: KaikkiSourceOptions): string {
  const fromEnv = process.env[opts.envVar];
  if (fromEnv) return fromEnv;
  // From .../src/lib/server/dictionary/sources/ up to apps/web/, then
  // into the configured default subpath.
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '../../../../../', opts.defaultPath);
}

export function makeKaikkiSource(opts: KaikkiSourceOptions): DictionaryImportSource {
  return {
    name: opts.name,
    language: opts.language,
    sourceAttribution: opts.attribution,
    license: opts.license,
    entries: () => streamKaikkiSource(resolvePath(opts), opts),
  };
}
