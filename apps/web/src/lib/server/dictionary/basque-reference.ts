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

// ---- URLs -------------------------------------------------------------

export function elhuyarUrl(word: string): string {
  return `https://hiztegiak.elhuyar.eus/eu/${encodeURIComponent(word.toLowerCase())}`;
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

// ---- Fetch + short cache ---------------------------------------------

type CacheEntry = { at: number; results: BasqueReferenceResult[] };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // mirrors the source scraper's 24h.

export type FetchImpl = (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

const defaultFetch: FetchImpl = (url) =>
  fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'text/html' } });

async function lookupOne(
  source: BasqueReferenceSource,
  word: string,
  fetchImpl: FetchImpl,
  now: number,
): Promise<BasqueReferenceResult[]> {
  const key = `${source}:${word.toLowerCase()}`;
  const cached = cache.get(key);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.results;

  const url = source === 'euskaltzaindia' ? euskaltzaindiaUrl(word) : elhuyarUrl(word);
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Upstream ${res.status} for ${source}`);
  const htmlText = await res.text();
  const results =
    source === 'euskaltzaindia'
      ? parseEuskaltzaindia(htmlText, word, url)
      : parseElhuyar(htmlText, source, word, url);

  cache.set(key, { at: now, results });
  return results;
}

/**
 * Look a word up in the requested reference dictionaries. A failed source
 * is skipped (never fails the whole request) so one site being down still
 * returns the others. Results are short-cached in memory per (source, word).
 */
export async function lookupBasqueReference(
  word: string,
  sources: BasqueReferenceSource[],
  opts: { fetchImpl?: FetchImpl; now?: number } = {},
): Promise<BasqueReferenceResult[]> {
  const fetchImpl = opts.fetchImpl ?? defaultFetch;
  const now = opts.now ?? Date.now();
  const trimmed = clean(word);
  if (!trimmed) return [];

  const out: BasqueReferenceResult[] = [];
  for (const source of sources) {
    try {
      out.push(...(await lookupOne(source, trimmed, fetchImpl, now)));
    } catch {
      // Reference aid — one source being unreachable shouldn't 500 the
      // whole panel. The admin still gets whatever else resolved.
    }
  }
  return out;
}

/** Test seam: clear the in-memory cache between cases. */
export function _clearBasqueReferenceCache(): void {
  cache.clear();
}
