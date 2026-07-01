/**
 * Admin-only Basque dictionary *reference* lookups (Elhuyar + Euskaltzaindia).
 *
 * These three dictionaries are proprietary — we never store or redistribute
 * their content. This module fetches and parses them on demand, server-side,
 * **only** to help an admin verify/curate translations (mirroring the user's
 * personal scraper at the time this shipped). Results are short-cached in
 * memory and never written to the `translations` table.
 *
 * Why server-side: the upstream sites send no CORS headers, so a browser
 * `fetch()` is blocked — the server has to make the request. The endpoint
 * that calls this is admin-gated (see
 * `routes/api/v1/admin/basque-dictionary/+server.ts`).
 *
 * The parse functions are pure (HTML string → results) so they unit-test
 * against fixtures without the network; `lookupBasqueReference` wraps them
 * with the fetch + cache. Selectors mirror the source scraper
 * (`parse_elhuyar_li`, `search_elhuyar`, `search_euskaltzaindia`).
 */
import { JSDOM } from 'jsdom';

export type BasqueReferenceSource = 'elhuyar_es' | 'elhuyar_en' | 'euskaltzaindia';

export const BASQUE_REFERENCE_SOURCES: readonly BasqueReferenceSource[] = [
  'elhuyar_es',
  'elhuyar_en',
  'euskaltzaindia',
];

export type BasqueReferenceResult = {
  source: BasqueReferenceSource;
  /** Human-facing source name, e.g. "Elhuyar eu-es". */
  label: string;
  headword: string;
  /** Part-of-speech abbreviation as printed by the source ("" if none). */
  pos: string;
  definition: string;
  examples: string[];
  /** The upstream page the result came from, for a "view source" link. */
  url: string;
};

export function isBasqueReferenceSource(value: string): value is BasqueReferenceSource {
  return (BASQUE_REFERENCE_SOURCES as readonly string[]).includes(value);
}

// Courteous, identifiable UA — the lookups are low-volume + admin-triggered.
const USER_AGENT =
  'CIA-Reader/1.0 (Basque dictionary admin reference; low-volume, on-demand)';

function clean(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/** Decode a form-encoded Elhuyar URL slug (`+`=space, `%XX`=escapes) back to
 *  its display headword. Elhuyar pads the hyphen in compound headwords with
 *  spaces ("goi + - + lautada"), so collapse a space-flanked hyphen back to a
 *  tight one ("goi-lautada") — genuine multi-word entries ("Afrika Erdiko
 *  Errepublika") and already-tight hyphens are left untouched. Returns the
 *  input unchanged if it can't be decoded. */
function decodeBasqueSlug(slug: string): string {
  try {
    return decodeURIComponent(slug.replace(/\+/g, ' ')).replace(/\s+-\s+/g, '-');
  } catch {
    return slug;
  }
}

// ---- URLs -------------------------------------------------------------

export function elhuyarUrl(word: string, opts: { preserveCase?: boolean } = {}): string {
  // Case matters upstream: "Afrika" (the continent) and "afrika"/"afrikaans" are
  // different entries. The auto-lemma path lowercases (a sentence-initial PROPN
  // often wants its common-noun reading); an explicit admin search preserves the
  // exact term it picked from autocomplete.
  const w = opts.preserveCase ? word : word.toLowerCase();
  return `https://hiztegiak.elhuyar.eus/eu/${encodeURIComponent(w)}`;
}

export function euskaltzaindiaUrl(word: string): string {
  const params = new URLSearchParams({
    option: 'com_hiztegianbilatu',
    task: 'bilaketa',
    Itemid: '1693',
    lang: 'eu',
    nondik: '0',
    zenbat: '50',
    non: 'sarreraBuruaStrict',
    query: word,
  });
  return `https://www.euskaltzaindia.eus/index.php?${params.toString()}`;
}

// ---- jsdom helpers ----------------------------------------------------

function directChildren(el: Element, tag: string): Element[] {
  const want = tag.toLowerCase();
  return Array.from(el.children).filter((c) => c.tagName.toLowerCase() === want);
}

/**
 * BeautifulSoup's `find_previous`: the nearest element *before* `el` in
 * document order (not just among siblings) matching `predicate`.
 */
function findPreviousMatching(
  el: Element,
  predicate: (e: Element) => boolean,
): Element | null {
  const all = Array.from(el.ownerDocument.querySelectorAll('*'));
  const idx = all.indexOf(el);
  for (let i = idx - 1; i >= 0; i -= 1) {
    if (predicate(all[i]!)) return all[i]!;
  }
  return null;
}

// ---- Elhuyar (eu→es / eu→en) -----------------------------------------

function parseElhuyarLi(
  li: Element,
  source: 'elhuyar_es' | 'elhuyar_en',
  label: string,
  headword: string,
  url: string,
): BasqueReferenceResult | null {
  const firstLine = li.querySelector('p.lehena');
  if (!firstLine) return null;

  // Drop link chrome / icons / badges before reading the definition text.
  firstLine.querySelectorAll('a[style], i.fa, span.badge').forEach((n) => n.remove());

  let pos = '';
  const posTag = firstLine.querySelector('em');
  if (posTag) {
    pos = clean(posTag.textContent);
    posTag.remove();
  }

  const definition = clean(firstLine.textContent);
  if (!definition) return null;

  const examples: string[] = [];
  for (const example of li.querySelectorAll('.padDefn p.text-muted')) {
    const text = clean(example.textContent);
    if (text) examples.push(text);
    if (examples.length >= 4) break;
  }

  return { source, label, headword, pos, definition, examples, url };
}

export function parseElhuyar(
  htmlText: string,
  source: 'elhuyar_es' | 'elhuyar_en',
  word: string,
  url: string,
): BasqueReferenceResult[] {
  const cssLanguage = source === 'elhuyar_es' ? 'eu_es' : 'eu_en';
  const label = source === 'elhuyar_es' ? 'Elhuyar eu-es' : 'Elhuyar eu-en';
  const { document } = new JSDOM(htmlText).window;
  const results: BasqueReferenceResult[] = [];

  for (const ul of document.querySelectorAll(`ul.hizkuntza-${cssLanguage}`)) {
    const heading = findPreviousMatching(
      ul,
      (e) =>
        e.tagName.toLowerCase() === 'div' &&
        e.className.includes('emaitza-lerroa') &&
        e.className.includes(`hizkuntza-${cssLanguage}`),
    );
    const h1 = heading?.querySelector('h1') ?? null;
    const headword =
      clean(h1?.textContent).replace(/^\d+\s+/, '') || clean(word);

    for (const li of directChildren(ul, 'li')) {
      const item = parseElhuyarLi(li, source, label, headword, url);
      if (item) results.push(item);
    }
  }

  return results.slice(0, 30);
}

// ---- Euskaltzaindiaren Hiztegia (monolingual eu) ----------------------

export function parseEuskaltzaindia(
  htmlText: string,
  word: string,
  url: string,
): BasqueReferenceResult[] {
  const { document } = new JSDOM(htmlText).window;
  const results: BasqueReferenceResult[] = [];

  for (const entry of document.querySelectorAll('.sarrera')) {
    const head =
      entry.querySelector('.sarrera-burua b') ?? entry.querySelector('.sarrera-burua');
    const headword = clean(head?.textContent) || clean(word);

    for (const sense of entry.querySelectorAll('.adiera')) {
      const number = clean(sense.querySelector('.sense-n')?.textContent);
      const pos = clean(sense.querySelector('.laburdura-pos')?.textContent);
      let definition = clean(sense.querySelector('.def')?.textContent);
      if (!definition) continue;
      if (number) definition = `${number}. ${definition}`;

      const examples = Array.from(sense.querySelectorAll('.dicteg i'))
        .map((x) => clean(x.textContent))
        .filter(Boolean)
        .slice(0, 5);

      results.push({
        source: 'euskaltzaindia',
        label: 'Euskaltzaindiaren Hiztegia',
        headword,
        pos,
        definition,
        examples,
        url,
      });
    }
  }

  return results.slice(0, 30);
}

// ---- Fetch + cache ---------------------------------------------------

//: How long a cached (word, source) entry stays fresh before we re-fetch.
//: Dictionary entries change rarely and the whole point is to spare the
//: upstream sites, so this is generous (30 days).
export const REFERENCE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type ReferenceCacheEntry = {
  results: BasqueReferenceResult[];
  fetchedAt: number;
};

/**
 * Pluggable, global (not per-user) cache for parsed reference results. The
 * production implementation is DB-backed (see `basque-reference-cache.ts`);
 * tests inject a fake. `lookupBasqueReference` defaults to no caching so the
 * pure path stays DB-free and deterministic.
 */
export interface ReferenceCache {
  get(word: string, source: BasqueReferenceSource): Promise<ReferenceCacheEntry | null>;
  set(word: string, source: BasqueReferenceSource, results: BasqueReferenceResult[], now: number): Promise<void>;
}

/** No-op cache — always misses, never stores. The default. */
export const nullReferenceCache: ReferenceCache = {
  async get() {
    return null;
  },
  async set() {
    /* no-op */
  },
};

export type FetchImpl = (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

const defaultFetch: FetchImpl = (url) =>
  fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'text/html' } });

async function lookupOne(
  source: BasqueReferenceSource,
  word: string,
  fetchImpl: FetchImpl,
  now: number,
  cache: ReferenceCache,
  preserveCase: boolean,
): Promise<BasqueReferenceResult[]> {
  const cached = await cache.get(word, source);
  if (cached && now - cached.fetchedAt < REFERENCE_CACHE_TTL_MS) return cached.results;

  const url =
    source === 'euskaltzaindia' ? euskaltzaindiaUrl(word) : elhuyarUrl(word, { preserveCase });
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Upstream ${res.status} for ${source}`);
  const htmlText = await res.text();
  const results =
    source === 'euskaltzaindia'
      ? parseEuskaltzaindia(htmlText, word, url)
      : parseElhuyar(htmlText, source, word, url);

  await cache.set(word, source, results, now);
  return results;
}

/**
 * Look a word up in the requested reference dictionaries. A failed source
 * is skipped (never fails the whole request) so one site being down still
 * returns the others. Results are read from / written to the supplied
 * global cache per (word, source) so we don't re-hit the upstream sites.
 */
export async function lookupBasqueReference(
  word: string,
  sources: BasqueReferenceSource[],
  opts: { fetchImpl?: FetchImpl; now?: number; cache?: ReferenceCache; preserveCase?: boolean } = {},
): Promise<BasqueReferenceResult[]> {
  const fetchImpl = opts.fetchImpl ?? defaultFetch;
  const now = opts.now ?? Date.now();
  const cache = opts.cache ?? nullReferenceCache;
  const preserveCase = opts.preserveCase ?? false;
  const cleaned = clean(word);
  const trimmed = preserveCase ? cleaned : cleaned.toLowerCase();
  if (!trimmed) return [];

  const out: BasqueReferenceResult[] = [];
  for (const source of sources) {
    try {
      out.push(...(await lookupOne(source, trimmed, fetchImpl, now, cache, preserveCase)));
    } catch {
      // Reference aid — one source being unreachable shouldn't 500 the
      // whole panel. The admin still gets whatever else resolved.
    }
  }
  return out;
}

// ---- Autocomplete ----------------------------------------------------

const ELHUYAR_AUTOCOMPLETE_URL = 'https://hiztegiak.elhuyar.eus/autocomplete/';

/**
 * Parse the Elhuyar autocomplete payload: an array of
 * `{ value: "/eu_es/<term>", label: "…<span class='sarrera'>term</span>…" }`.
 * We take the term out of `value` because it keeps the exact spelling/case the
 * admin should search ("Afrika" vs "afrikaans"). Deduped, capped, fail-soft.
 */
export function parseElhuyarAutocomplete(jsonText: string): string[] {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const item of raw) {
    const value = (item as { value?: unknown }).value;
    if (typeof value !== 'string') continue;
    // `value` is a URL path (`/eu_es/<slug>`) whose slug is form-encoded: a
    // space is `+`, other reserved chars are `%XX`. Decode it before display,
    // else a multi-word entry like "goi - lautada" surfaces literally as
    // "goi+-+lautada". `+`→space first (decodeURIComponent leaves `+` as-is),
    // then percent-decode; fall back to the raw slug if it's malformed.
    const slug = value.replace(/^\/[a-z_]+\//, '');
    const term = clean(decodeBasqueSlug(slug));
    if (!term || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
    if (terms.length >= 20) break;
  }
  return terms;
}

/**
 * Elhuyar autocomplete suggestions for a Basque search term. Reference-only and
 * admin-gated at the route. Lets a curator pick the exact dictionary entry
 * instead of trusting the (possibly mis-parsed, possibly mis-cased) lemma.
 */
export async function searchElhuyarAutocomplete(
  term: string,
  opts: { fetchImpl?: FetchImpl } = {},
): Promise<string[]> {
  const trimmed = clean(term);
  if (!trimmed) return [];
  const fetchImpl = opts.fetchImpl ?? defaultFetch;
  const url = `${ELHUYAR_AUTOCOMPLETE_URL}?${new URLSearchParams({
    term: trimmed,
    hizkuntza: 'eu_es',
  }).toString()}`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Autocomplete ${res.status}`);
  return parseElhuyarAutocomplete(await res.text());
}
