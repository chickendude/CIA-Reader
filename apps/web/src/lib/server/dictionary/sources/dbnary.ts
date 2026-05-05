/**
 * Generic Dbnary → CIA Reader importer factory (T-3.10b/e).
 *
 * Dbnary (kaiko.getalp.org) publishes per-language Turtle dumps that
 * follow the lemon/ontolex vocabulary. Each language ships at a stable
 * URL like
 * `https://kaiko.getalp.org/static/ontolex/latest/<lang3>_dbnary_ontolex.ttl.bz2`,
 * and the per-entry shape is regular enough that we can pattern-match
 * the relevant predicates line-by-line without pulling in a full RDF
 * parser. The shape we care about per `LexicalEntry` IRI:
 *
 *   <entry> rdf:type ontolex:LexicalEntry
 *   <entry> rdfs:label "headword"@<lang>
 *   <entry> ontolex:canonicalForm <form>      (form's writtenRep wins over rdfs:label when present)
 *   <form>  ontolex:writtenRep "headword"@<lang>
 *   <entry> lexinfo:partOfSpeech lexinfo:noun (or :verb, :adjective, ...)
 *   <entry> ontolex:sense <sense>
 *   <sense> skos:definition "definition"@<lang>
 *   <sense> ontolex:reference <translation_iri>     (occasionally; gloss is the workhorse)
 *
 * We deliberately handle a small subset of Turtle:
 *   - `@prefix p: <iri> .`
 *   - subject-predicate-object statements terminated by `.` or `;`
 *   - prefixed-name resolution (`p:foo` → `<iri>foo`)
 *   - quoted-string literals with optional `@lang` tag
 *
 * Things we don't handle (and don't need for Dbnary's regular schema):
 *   - blank nodes, multi-line strings, datatypes other than the
 *     lang-tag, comma- or semicolon-list expansion across multiple
 *     objects on one predicate (Dbnary publishes one object per
 *     statement), `[]` anonymous subjects, `BASE` directives.
 *
 * If the upstream schema later drifts in a way the scanner can't
 * follow, replacing this with `n3` is one drop-in swap.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { LanguageCode } from '@ciareader/shared-types';

import type { DictionaryImportSource, ImportEntry } from '../types.js';

export type Triple = {
  subject: string;
  predicate: string;
  object: TripleObject;
};

export type TripleObject =
  | { kind: 'iri'; value: string }
  | { kind: 'literal'; value: string; lang?: string };

/**
 * Map lexinfo POS IRIs onto the UD-style tags the rest of the codebase
 * uses. Anything not in this map (phrase, prefix, suffix, etc.) drops
 * the entry — same policy as the Kaikki importer.
 */
const POS_MAP: Record<string, string> = {
  noun: 'NOUN',
  properNoun: 'PROPN',
  verb: 'VERB',
  adjective: 'ADJ',
  adverb: 'ADV',
  pronoun: 'PRON',
  conjunction: 'CCONJ',
  subordinatingConjunction: 'SCONJ',
  preposition: 'ADP',
  postposition: 'ADP',
  interjection: 'INTJ',
  numeral: 'NUM',
  particle: 'PART',
  determiner: 'DET',
  article: 'DET',
};

export function mapDbnaryPos(iri: string): string | null {
  // The lexinfo IRIs end with the POS local name, e.g.
  // `http://www.lexinfo.net/ontology/2.0/lexinfo#noun`.
  const hash = iri.lastIndexOf('#');
  const slash = iri.lastIndexOf('/');
  const local = iri.slice(Math.max(hash, slash) + 1);
  return POS_MAP[local] ?? null;
}

// Default prefixes — a Turtle dump that omits these (uncommon for
// Dbnary) will still resolve since the prefix table updates as
// `@prefix` directives are seen. Prefilled values match what Dbnary
// emits in their dump headers as of 2026-05.
const DEFAULT_PREFIXES: Record<string, string> = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  skos: 'http://www.w3.org/2004/02/skos/core#',
  owl: 'http://www.w3.org/2002/07/owl#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  ontolex: 'http://www.w3.org/ns/lemon/ontolex#',
  lexinfo: 'http://www.lexinfo.net/ontology/2.0/lexinfo#',
  dbnary: 'http://kaiko.getalp.org/dbnary#',
  lime: 'http://www.w3.org/ns/lemon/lime#',
  vartrans: 'http://www.w3.org/ns/lemon/vartrans#',
  decomp: 'http://www.w3.org/ns/lemon/decomp#',
  dcterms: 'http://purl.org/dc/terms/',
};

const PREFIX_RE = /^@prefix\s+([^:\s]*):\s+<([^>]*)>\s*\.\s*$/;

const RDF_TYPE = `${DEFAULT_PREFIXES.rdf}type`;
const RDFS_LABEL = `${DEFAULT_PREFIXES.rdfs}label`;
const SKOS_DEFINITION = `${DEFAULT_PREFIXES.skos}definition`;
const ONTOLEX_LEXICAL_ENTRY = `${DEFAULT_PREFIXES.ontolex}LexicalEntry`;
const ONTOLEX_CANONICAL_FORM = `${DEFAULT_PREFIXES.ontolex}canonicalForm`;
const ONTOLEX_WRITTEN_REP = `${DEFAULT_PREFIXES.ontolex}writtenRep`;
const ONTOLEX_SENSE = `${DEFAULT_PREFIXES.ontolex}sense`;
const LEXINFO_POS = `${DEFAULT_PREFIXES.lexinfo}partOfSpeech`;

/**
 * Streaming line tokenizer for the Turtle subset we care about.
 *
 * State machine: maintain `currentSubject` so semicolon-continued
 * statements (`<s> p1 o1 ; p2 o2 .`) all land on the same subject.
 * `;`-terminated statements keep the subject; `.`-terminated reset it.
 *
 * Rather than implementing a full lexer we exploit Turtle's regular
 * shape — each statement (post-prefix-substitution) is one of:
 *
 *   <iri>   <iri>   <iri>    .
 *   <iri>   <iri>   "lit"@lg .
 *   ...     ...     ...      ;        (continuation)
 *
 * with leading prefixed names resolved against `@prefix` directives.
 * Dbnary emits one statement per line in its published dumps, so
 * scanning per-line is sufficient.
 */
export async function* parseTurtle(
  lines: AsyncIterable<string> | Iterable<string>,
): AsyncIterable<Triple> {
  const prefixes = { ...DEFAULT_PREFIXES };
  let currentSubject: string | null = null;
  for await (const raw of toAsyncIterable(lines)) {
    const line = stripComment(raw).trim();
    if (!line) continue;

    const prefixMatch = PREFIX_RE.exec(line);
    if (prefixMatch) {
      const [, name, iri] = prefixMatch as unknown as [string, string, string];
      prefixes[name] = iri;
      continue;
    }

    // Trailing terminator decides whether the next line keeps this
    // subject or resets it.
    let body = line;
    let resetSubject = false;
    if (body.endsWith('.')) {
      resetSubject = true;
      body = body.slice(0, -1).trim();
    } else if (body.endsWith(';')) {
      resetSubject = false;
      body = body.slice(0, -1).trim();
    } else {
      // Unterminated line — Dbnary wraps complex multi-object
      // statements onto separate lines via `;` so we shouldn't
      // see this in practice. Skip rather than crash.
      continue;
    }

    const tokens = tokenize(body);
    if (tokens.length === 0) {
      if (resetSubject) currentSubject = null;
      continue;
    }

    let subject: string;
    let rest: string[];
    if (currentSubject && tokens.length === 2) {
      // Continuation of the previous subject (after a `;`).
      subject = currentSubject;
      rest = tokens;
    } else if (tokens.length >= 3) {
      subject = resolveIri(tokens[0]!, prefixes) ?? tokens[0]!;
      rest = tokens.slice(1);
      currentSubject = subject;
    } else {
      // Malformed — needs a subject we haven't seen.
      if (resetSubject) currentSubject = null;
      continue;
    }

    if (rest.length < 2) {
      if (resetSubject) currentSubject = null;
      continue;
    }
    const predicate = resolveIri(rest[0]!, prefixes) ?? rest[0]!;
    const objectTok = rest.slice(1).join(' ');
    const object = parseObject(objectTok, prefixes);
    if (object) {
      yield { subject, predicate, object };
    }

    if (resetSubject) currentSubject = null;
  }
}

function stripComment(line: string): string {
  // `#` is an in-line comment marker only outside string literals
  // and outside IRI angle-brackets — most lemon-vocabulary IRIs end
  // in `#fragment` (e.g. `ontolex#LexicalEntry`), so a naive strip
  // would mangle every lemon predicate.
  let inString = false;
  let inIri = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inString) {
      if (c === '"' && line[i - 1] !== '\\') inString = false;
      continue;
    }
    if (inIri) {
      if (c === '>') inIri = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === '<') {
      inIri = true;
      continue;
    }
    if (c === '#') return line.slice(0, i);
  }
  return line;
}

/**
 * Split a Turtle statement body into IRI / prefixed-name / literal
 * tokens. Literals can contain spaces, so we walk the string in a
 * mini state machine instead of `split(/\s+/)`.
 */
export function tokenize(body: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === ' ' || c === '\t') {
      i += 1;
      continue;
    }
    if (c === '<') {
      const end = body.indexOf('>', i);
      if (end === -1) break;
      out.push(body.slice(i, end + 1));
      i = end + 1;
      continue;
    }
    if (c === '"') {
      // Walk past the closing quote, honouring `\"` escapes; then
      // include any trailing `@lang` or `^^datatype` suffix.
      let j = i + 1;
      while (j < body.length) {
        if (body[j] === '\\') {
          j += 2;
          continue;
        }
        if (body[j] === '"') break;
        j += 1;
      }
      let end = j + 1;
      if (body[end] === '@') {
        end += 1;
        while (end < body.length && /[A-Za-z0-9-]/.test(body[end]!)) end += 1;
      } else if (body[end] === '^' && body[end + 1] === '^') {
        end += 2;
        if (body[end] === '<') {
          const close = body.indexOf('>', end);
          end = close === -1 ? body.length : close + 1;
        } else {
          while (end < body.length && !/\s/.test(body[end]!)) end += 1;
        }
      }
      out.push(body.slice(i, end));
      i = end;
      continue;
    }
    // Prefixed name like `lexinfo:noun` or a bare `a` (rdf:type alias).
    let j = i;
    while (j < body.length && !/\s/.test(body[j]!)) j += 1;
    out.push(body.slice(i, j));
    i = j;
  }
  return out;
}

function resolveIri(token: string, prefixes: Record<string, string>): string | null {
  if (token === 'a') return RDF_TYPE;
  if (token.startsWith('<') && token.endsWith('>')) {
    return token.slice(1, -1);
  }
  const colon = token.indexOf(':');
  if (colon === -1) return null;
  const name = token.slice(0, colon);
  const local = token.slice(colon + 1);
  const base = prefixes[name];
  if (!base) return null;
  return base + local;
}

function parseObject(
  tok: string,
  prefixes: Record<string, string>,
): TripleObject | null {
  const trimmed = tok.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    return { kind: 'iri', value: trimmed.slice(1, -1) };
  }
  if (trimmed.startsWith('"')) {
    return parseLiteral(trimmed);
  }
  const iri = resolveIri(trimmed, prefixes);
  if (iri) return { kind: 'iri', value: iri };
  return null;
}

function parseLiteral(tok: string): TripleObject | null {
  // Find the closing quote that isn't escaped.
  let end = -1;
  for (let i = 1; i < tok.length; i += 1) {
    if (tok[i] === '\\') {
      i += 1;
      continue;
    }
    if (tok[i] === '"') {
      end = i;
      break;
    }
  }
  if (end === -1) return null;
  const value = unescapeTurtleString(tok.slice(1, end));
  let lang: string | undefined;
  const after = tok.slice(end + 1);
  if (after.startsWith('@')) {
    const m = /^@([A-Za-z0-9-]+)/.exec(after);
    if (m) lang = m[1]!;
  }
  return lang ? { kind: 'literal', value, lang } : { kind: 'literal', value };
}

function unescapeTurtleString(raw: string): string {
  return raw.replace(/\\(.)/g, (_m, c: string) => {
    switch (c) {
      case 'n':
        return '\n';
      case 't':
        return '\t';
      case 'r':
        return '\r';
      case '\\':
        return '\\';
      case '"':
        return '"';
      default:
        return c;
    }
  });
}

function toAsyncIterable<T>(source: AsyncIterable<T> | Iterable<T>): AsyncIterable<T> {
  if (Symbol.asyncIterator in (source as object)) {
    return source as AsyncIterable<T>;
  }
  return (async function* () {
    for (const value of source as Iterable<T>) {
      yield value;
    }
  })();
}

// ─── Entry assembly ──────────────────────────────────────────────────

type PendingEntry = {
  iri: string;
  isLexicalEntry: boolean;
  headword?: string;
  pos?: string;
  canonicalFormIri?: string;
  senses: string[];
};

type PendingForm = {
  iri: string;
  writtenRep?: string;
};

type PendingSense = {
  iri: string;
  definitions: { body: string; lang?: string }[];
};

export type DbnarySourceOptions = {
  name: string;
  language: LanguageCode;
  /** ISO 15924 code: Deva, Orya, etc. */
  script: string;
  sourceIdPrefix: string;
  attribution: string;
  license: string;
  envVar: string;
  defaultPath: string;
  /**
   * BCP-47 lang tag we expect on `rdfs:label` / `ontolex:writtenRep`
   * literals (e.g. 'hi', 'mr', 'or'). Labels without a lang tag are
   * still accepted; labels with a different tag are dropped.
   */
  headwordLang: string;
  /**
   * BCP-47 lang tag we accept for `skos:definition` translations.
   * Defaults to 'en' — Dbnary's English-side translations.
   */
  translationLang?: string;
};

/**
 * Read a Turtle stream and emit `ImportEntry` per `LexicalEntry`. The
 * second pass over `pending` handles the case where the
 * `canonicalForm` IRI is declared after the entry that references it —
 * Dbnary's published files are subject-grouped, but not strictly
 * topologically ordered.
 */
export async function* streamDbnarySource(
  filePath: string,
  opts: DbnarySourceOptions,
): AsyncIterable<ImportEntry> {
  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  const entries = new Map<string, PendingEntry>();
  const forms = new Map<string, PendingForm>();
  const senses = new Map<string, PendingSense>();

  for await (const triple of parseTurtle(rl)) {
    handleTriple(triple, entries, forms, senses, opts);
  }

  for (const entry of entries.values()) {
    const built = buildImportEntry(entry, forms, senses, opts);
    if (built) yield built;
  }
}

export function handleTriple(
  triple: Triple,
  entries: Map<string, PendingEntry>,
  forms: Map<string, PendingForm>,
  senses: Map<string, PendingSense>,
  opts: Pick<DbnarySourceOptions, 'headwordLang' | 'translationLang'>,
): void {
  const { subject, predicate, object } = triple;

  if (predicate === RDF_TYPE && object.kind === 'iri') {
    if (object.value === ONTOLEX_LEXICAL_ENTRY) {
      const e = entries.get(subject) ?? newEntry(subject);
      e.isLexicalEntry = true;
      entries.set(subject, e);
    }
    return;
  }

  if (predicate === RDFS_LABEL && object.kind === 'literal') {
    if (acceptsLang(object.lang, opts.headwordLang)) {
      const e = entries.get(subject) ?? newEntry(subject);
      e.headword = object.value;
      entries.set(subject, e);
    }
    return;
  }

  if (predicate === LEXINFO_POS && object.kind === 'iri') {
    const pos = mapDbnaryPos(object.value);
    if (pos) {
      const e = entries.get(subject) ?? newEntry(subject);
      e.pos = pos;
      entries.set(subject, e);
    }
    return;
  }

  if (predicate === ONTOLEX_CANONICAL_FORM && object.kind === 'iri') {
    const e = entries.get(subject) ?? newEntry(subject);
    e.canonicalFormIri = object.value;
    entries.set(subject, e);
    return;
  }

  if (predicate === ONTOLEX_SENSE && object.kind === 'iri') {
    const e = entries.get(subject) ?? newEntry(subject);
    e.senses.push(object.value);
    entries.set(subject, e);
    return;
  }

  if (predicate === ONTOLEX_WRITTEN_REP && object.kind === 'literal') {
    if (acceptsLang(object.lang, opts.headwordLang)) {
      const f = forms.get(subject) ?? { iri: subject };
      f.writtenRep = object.value;
      forms.set(subject, f);
    }
    return;
  }

  if (predicate === SKOS_DEFINITION && object.kind === 'literal') {
    const want = opts.translationLang ?? 'en';
    if (acceptsLang(object.lang, want)) {
      const s = senses.get(subject) ?? { iri: subject, definitions: [] };
      s.definitions.push({ body: object.value, lang: object.lang });
      senses.set(subject, s);
    }
    return;
  }
}

function newEntry(iri: string): PendingEntry {
  return { iri, isLexicalEntry: false, senses: [] };
}

function acceptsLang(actual: string | undefined, expected: string): boolean {
  if (!actual) return true;
  return actual.toLowerCase().split('-')[0] === expected.toLowerCase();
}

export function buildImportEntry(
  entry: PendingEntry,
  forms: Map<string, PendingForm>,
  senses: Map<string, PendingSense>,
  opts: DbnarySourceOptions,
): ImportEntry | null {
  if (!entry.isLexicalEntry) return null;
  const fromForm = entry.canonicalFormIri
    ? forms.get(entry.canonicalFormIri)?.writtenRep
    : undefined;
  const headword = (fromForm ?? entry.headword)?.normalize('NFC').trim();
  if (!headword) return null;
  const pos = entry.pos;
  if (!pos) return null;

  const translations: { sourceId: string; body: string }[] = [];
  const seen = new Set<string>();
  let translationIdx = 0;
  for (const senseIri of entry.senses) {
    const sense = senses.get(senseIri);
    if (!sense) continue;
    for (const def of sense.definitions) {
      const body = def.body.trim();
      if (!body || seen.has(body)) continue;
      seen.add(body);
      translations.push({
        sourceId: `${opts.sourceIdPrefix}:sense:${shortHash(senseIri)}:${translationIdx}`,
        body,
      });
      translationIdx += 1;
    }
  }
  if (translations.length === 0) return null;

  return {
    sourceId: `${opts.sourceIdPrefix}:${shortHash(entry.iri)}`,
    headword,
    pos,
    script: opts.script,
    glossDefault: translations[0]!.body,
    translations,
  };
}

function shortHash(s: string): string {
  return createHash('sha1').update(s).digest('hex').slice(0, 12);
}

function resolvePath(opts: DbnarySourceOptions): string {
  const fromEnv = process.env[opts.envVar];
  if (fromEnv) return fromEnv;
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '../../../../../', opts.defaultPath);
}

export function makeDbnarySource(opts: DbnarySourceOptions): DictionaryImportSource {
  return {
    name: opts.name,
    language: opts.language,
    sourceAttribution: opts.attribution,
    license: opts.license,
    entries: () => streamDbnarySource(resolvePath(opts), opts),
  };
}
