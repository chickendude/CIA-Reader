/**
 * Inverted Kaikki English → Indic-language importer (T-3.10).
 *
 * Kaikki publishes the full English Wiktionary as JSONL, and each
 * entry's `translations[]` array carries `{lang_code, word, sense, ...}`
 * tuples covering hundreds of target languages — including HI / MR /
 * OR. Inverting that gives us L-language headwords with English
 * translations, complementing the per-language Kaikki dumps we already
 * import (which only see what Wiktionary's HI/MR/OR sub-corpus
 * documented locally).
 *
 * The English Wiktionary's Translations sections are typically much
 * richer than its small-language sub-corpora, so this is the highest-
 * leverage second pass on Wiktionary data — especially for Marathi
 * and Odia where the per-language coverage is thin.
 *
 * Stable upstream identity: one row per (target lang × target word ×
 * English word × sense). `source_id` =
 * `kaikki-en:<lang>:<word>:<pos>:<sha1(en_word|sense)[..12]>`
 * so Wiktionary edits to a sense reshape the source_id and create a
 * fresh row, while no-change re-imports update in place.
 *
 * The import path stays idempotent on `(language, source, source_id)`;
 * the dropped `(language, headword, pos)` unique constraint (T-3.10)
 * means multiple rows of the same Hindi headword are expected and a
 * curator merges duplicates via T-3.7's existing flow.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { LanguageCode } from '@ciareader/shared-types';

import type { DictionaryImportSource, ImportEntry } from '../types.js';
import { mapKaikkiPos } from './kaikki.js';

export type KaikkiEnTranslation = {
  lang_code?: string;
  word?: string;
  sense?: string;
  tags?: string[];
};

export type KaikkiEnEntry = {
  word: string;
  pos: string;
  translations?: KaikkiEnTranslation[];
};

/**
 * Parse one line of the English Kaikki JSONL. Returns null for blank
 * lines, malformed JSON, or rows missing required fields. Caller
 * filters nulls; we never throw because Kaikki dumps occasionally
 * include non-JSON debug rows that we don't want to crash the import.
 */
export function parseKaikkiEnLine(line: string): KaikkiEnEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed) as Partial<KaikkiEnEntry>;
    if (typeof obj.word !== 'string' || typeof obj.pos !== 'string') return null;
    return obj as KaikkiEnEntry;
  } catch {
    return null;
  }
}

/**
 * Synthesize a stable per-row source_id. The ENGLISH word + sense
 * uniquely identifies the upstream cell — when Wiktionary edits the
 * sense text, the hash changes and we end up with a fresh row (the
 * old one ages out as a curator merge candidate); when nothing
 * changes, re-imports update in place.
 */
function rowSourceId(
  prefix: string,
  headword: string,
  pos: string,
  enWord: string,
  sense: string,
): string {
  const hash = createHash('sha1')
    .update(`${enWord}|${sense}`)
    .digest('hex')
    .slice(0, 12);
  return `${prefix}:${headword}:${pos}:${hash}`;
}

export type KaikkiEnTranslationsOptions = {
  /** Stable name (e.g. 'kaikki-en-translations-hindi'). */
  name: string;
  /** Target language to invert into (e.g. 'hi'). */
  targetLang: LanguageCode;
  /** ISO 15924 script code for the target (Deva / Orya / ...). */
  script: string;
  /** Prefix for synthesized source_ids, e.g. 'kaikki-en:hi'. */
  sourceIdPrefix: string;
  attribution: string;
  license: string;
};

/**
 * Convert one English entry's translations into ImportEntry rows for a
 * specific target language. Yields one entry per matching translation
 * row that has a usable headword and POS.
 */
export function* enEntryToImportEntries(
  raw: KaikkiEnEntry,
  opts: Pick<KaikkiEnTranslationsOptions, 'targetLang' | 'script' | 'sourceIdPrefix'>,
): Generator<ImportEntry, void, void> {
  const pos = mapKaikkiPos(raw.pos);
  if (!pos) return;
  const enWord = (raw.word ?? '').trim();
  if (!enWord) return;
  const translations = raw.translations ?? [];
  for (const t of translations) {
    if (t.lang_code !== opts.targetLang) continue;
    const headword = (t.word ?? '').normalize('NFC').trim();
    if (!headword) continue;
    const sense = (t.sense ?? '').trim();
    const sourceId = rowSourceId(opts.sourceIdPrefix, headword, pos, enWord, sense);
    // The translation body is the English headword; the sense
    // disambiguates between multiple translations of the same target
    // word, but we keep it out of the body so the popup stays scannable.
    // Long-term (post-MVP) we'll surface sense as a tooltip / secondary
    // line in the popup.
    const translationSourceId = `${sourceId}:t`;
    const entry: ImportEntry = {
      sourceId,
      headword,
      pos,
      script: opts.script,
      glossDefault: enWord,
      translations: [{ sourceId: translationSourceId, body: enWord }],
    };
    yield entry;
  }
}

async function* streamKaikkiEnTranslations(
  filePath: string,
  opts: Pick<KaikkiEnTranslationsOptions, 'targetLang' | 'script' | 'sourceIdPrefix'>,
): AsyncIterable<ImportEntry> {
  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const raw = parseKaikkiEnLine(line);
    if (!raw) continue;
    yield* enEntryToImportEntries(raw, opts);
  }
}

/**
 * Resolve the path to the SHARED English JSONL artifact. All three
 * language importers (HI / MR / OR) read the same file — running them
 * back-to-back streams the file three times, which is fine for a
 * one-time bulk import. Tests inject a fixture via the env var.
 */
function resolveSharedPath(): string {
  if (process.env.KAIKKI_EN_TRANSLATIONS_FILE) {
    return process.env.KAIKKI_EN_TRANSLATIONS_FILE;
  }
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(
    here,
    '../../../../../data/dictionaries/kaikki-en-translations/raw.jsonl',
  );
}

export function makeKaikkiEnTranslationsSource(
  opts: KaikkiEnTranslationsOptions,
): DictionaryImportSource {
  return {
    name: opts.name,
    language: opts.targetLang,
    sourceAttribution: opts.attribution,
    license: opts.license,
    entries: () =>
      streamKaikkiEnTranslations(resolveSharedPath(), {
        targetLang: opts.targetLang,
        script: opts.script,
        sourceIdPrefix: opts.sourceIdPrefix,
      }),
  };
}
