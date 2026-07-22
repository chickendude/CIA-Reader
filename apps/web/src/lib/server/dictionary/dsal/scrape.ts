/**
 * Polite, resumable scraper for the DSAL query CGI.
 *
 * Operator-run only — this is a multi-minute crawl of a third-party
 * university server, so it is deliberately NOT wired to the admin UI's
 * Re-fetch button or CI (`fetch-dictionary-sources.sh` just checks the
 * parsed artifact exists and points the operator here).
 *
 * Behavior:
 *  - one request per initial letter (≈50 per dictionary, ~200 total),
 *    serial, with a jittered delay between requests;
 *  - identifies itself with a contact address in the User-Agent;
 *  - retries transient failures (5xx / network) with backoff, but
 *    aborts the whole run on 403/429 — if DSAL pushes back we stop and
 *    investigate rather than hammer;
 *  - caches each response as `scrape/q-<idx>-<letter>.html` next to a
 *    `manifest.json`, and skips queries already cached, so a killed run
 *    resumes where it left off and the parse step never needs the
 *    network again.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { DsalDictionaryConfig } from './config.js';

export const DSAL_USER_AGENT =
  'ciareader-dsal-scraper/1.0 (contact: pokemaster103@gmail.com)';

export const DEFAULT_DELAY_MS = 2000;
const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 5000;

export type ScrapeQuery = {
  qs: string;
  /** `default` is the CGI's "beginning with" mode. */
  matchtype: 'default';
};

export function planQueries(config: DsalDictionaryConfig, letters?: string[]): ScrapeQuery[] {
  const initials = letters && letters.length > 0 ? letters : config.queryAlphabet;
  return initials.map((qs) => ({ qs, matchtype: 'default' as const }));
}

export function queryUrl(config: DsalDictionaryConfig, query: ScrapeQuery): string {
  const params = new URLSearchParams({
    qs: query.qs,
    searchhws: 'yes',
    matchtype: query.matchtype,
  });
  return `https://dsal.uchicago.edu/cgi-bin/app/${config.cgiSlug}_query.py?${params.toString()}`;
}

/** `q-007-ऐ.html` — the index prefix keeps directory listings in scrape order. */
export function queryFileName(index: number, query: ScrapeQuery): string {
  return `q-${String(index).padStart(3, '0')}-${query.qs}.html`;
}

export type ManifestEntry = {
  qs: string;
  matchtype: string;
  url: string;
  fetchedAt: string;
  bytes: number;
  httpStatus: number;
  sha1: string;
};

export type ScrapeManifest = Record<string, ManifestEntry>;

export function loadManifest(scrapeDir: string): ScrapeManifest {
  const path = join(scrapeDir, 'manifest.json');
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as ScrapeManifest;
  } catch {
    return {};
  }
}

function saveManifest(scrapeDir: string, manifest: ScrapeManifest): void {
  const path = join(scrapeDir, 'manifest.json');
  writeFileSync(`${path}.tmp`, JSON.stringify(manifest, null, 2));
  renameSync(`${path}.tmp`, path);
}

/** Thrown when DSAL answers 403/429 — the operator should stop and investigate. */
export class ScrapeAbortError extends Error {
  constructor(
    public readonly url: string,
    public readonly status: number,
  ) {
    super(`DSAL answered ${status} for ${url} — aborting the run instead of retrying`);
    this.name = 'ScrapeAbortError';
  }
}

export type FetchLike = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{ status: number; text(): Promise<string> }>;

export type ScrapeOptions = {
  /** `data/dictionaries` root; the scraper writes under `<root>/<slug>/scrape/`. */
  dataRoot: string;
  /** Restrict the run to specific initials (probe mode). */
  letters?: string[];
  /** Re-fetch queries that are already cached. */
  force?: boolean;
  delayMs?: number;
  /** Injected for tests. */
  fetchImpl?: FetchLike;
  sleepImpl?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
};

export type ScrapeSummary = {
  fetched: number;
  skippedCached: number;
  totalBytes: number;
};

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(
  url: string,
  fetchImpl: FetchLike,
  sleep: (ms: number) => Promise<void>,
  log: (m: string) => void,
): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    let status: number | undefined;
    try {
      const res = await fetchImpl(url, { headers: { 'User-Agent': DSAL_USER_AGENT } });
      status = res.status;
      if (res.status === 403 || res.status === 429) throw new ScrapeAbortError(url, res.status);
      if (res.status >= 200 && res.status < 300) return await res.text();
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (err instanceof ScrapeAbortError) throw err;
      if (attempt >= MAX_ATTEMPTS) {
        throw new Error(
          `giving up on ${url} after ${MAX_ATTEMPTS} attempts (last: ${status ?? String(err)})`,
        );
      }
      const backoff = BACKOFF_BASE_MS * 2 ** (attempt - 1);
      log(`  retry ${attempt}/${MAX_ATTEMPTS - 1} in ${backoff / 1000}s (${String(err)})`);
      await sleep(backoff);
    }
  }
}

export async function runScrape(
  config: DsalDictionaryConfig,
  opts: ScrapeOptions,
): Promise<ScrapeSummary> {
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const sleep = opts.sleepImpl ?? realSleep;
  const log = opts.log ?? (() => {});
  const delayMs = opts.delayMs ?? DEFAULT_DELAY_MS;

  const scrapeDir = join(opts.dataRoot, config.slug, 'scrape');
  mkdirSync(scrapeDir, { recursive: true });
  const manifest = loadManifest(scrapeDir);

  const queries = planQueries(config, opts.letters);
  // Index by position in the FULL alphabet so a --letters probe writes
  // the same filename a full run would.
  const indexOf = (qs: string): number => {
    const i = config.queryAlphabet.indexOf(qs);
    return i === -1 ? config.queryAlphabet.length + queries.findIndex((q) => q.qs === qs) : i;
  };

  const summary: ScrapeSummary = { fetched: 0, skippedCached: 0, totalBytes: 0 };
  let first = true;

  for (const query of queries) {
    const fileName = queryFileName(indexOf(query.qs), query);
    const filePath = join(scrapeDir, fileName);
    const cached =
      !opts.force && manifest[fileName] && existsSync(filePath) && statSync(filePath).size > 0;
    if (cached) {
      summary.skippedCached += 1;
      log(`[scrape] ${config.slug} ${query.qs} cached (${manifest[fileName]!.bytes} bytes) — skipping`);
      continue;
    }

    if (!first) {
      // Jittered politeness delay between consecutive live requests.
      await sleep(delayMs * (0.8 + Math.random() * 0.4));
    }
    first = false;

    const url = queryUrl(config, query);
    log(`[scrape] ${config.slug} ${query.qs} → ${fileName}`);
    const html = await fetchWithRetry(url, fetchImpl, sleep, log);

    writeFileSync(`${filePath}.tmp`, html);
    renameSync(`${filePath}.tmp`, filePath);
    manifest[fileName] = {
      qs: query.qs,
      matchtype: query.matchtype,
      url,
      fetchedAt: new Date().toISOString(),
      bytes: Buffer.byteLength(html),
      httpStatus: 200,
      sha1: createHash('sha1').update(html).digest('hex'),
    };
    // Persist after every fetch so a killed run loses at most one response.
    saveManifest(scrapeDir, manifest);
    summary.fetched += 1;
    summary.totalBytes += Buffer.byteLength(html);
  }

  return summary;
}
