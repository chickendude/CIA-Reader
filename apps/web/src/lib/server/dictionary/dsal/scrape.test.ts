// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DSAL_DICTIONARIES } from './config.js';
import {
  DSAL_USER_AGENT,
  ScrapeAbortError,
  loadManifest,
  planQueries,
  queryFileName,
  queryUrl,
  runScrape,
} from './scrape.js';
import type { FetchLike } from './scrape.js';

const config = DSAL_DICTIONARIES['dsal-molesworth'];

const ok = (body: string): { status: number; text: () => Promise<string> } => ({
  status: 200,
  text: () => Promise.resolve(body),
});

describe('planQueries / queryUrl / queryFileName', () => {
  it('plans one beginning-with query per alphabet letter by default', () => {
    const plan = planQueries(config);
    expect(plan).toHaveLength(config.queryAlphabet.length);
    expect(plan[0]).toEqual({ qs: config.queryAlphabet[0], matchtype: 'default' });
  });

  it('restricts to explicit letters for probes', () => {
    expect(planQueries(config, ['क', 'ख'])).toEqual([
      { qs: 'क', matchtype: 'default' },
      { qs: 'ख', matchtype: 'default' },
    ]);
  });

  it('builds the CGI URL with encoded query string', () => {
    const url = queryUrl(config, { qs: 'क', matchtype: 'default' });
    expect(url).toBe(
      'https://dsal.uchicago.edu/cgi-bin/app/molesworth_query.py?qs=%E0%A4%95&searchhws=yes&matchtype=default',
    );
  });

  it('pads the index so listings sort in scrape order', () => {
    expect(queryFileName(7, { qs: 'ऐ', matchtype: 'default' })).toBe('q-007-ऐ.html');
  });
});

describe('runScrape', () => {
  let dataRoot: string;
  let sleeps: number[];
  const sleepImpl = (ms: number): Promise<void> => {
    sleeps.push(ms);
    return Promise.resolve();
  };

  beforeEach(() => {
    dataRoot = mkdtempSync(join(tmpdir(), 'dsal-scrape-test-'));
    sleeps = [];
  });

  afterEach(() => {
    rmSync(dataRoot, { recursive: true, force: true });
  });

  it('fetches every planned query, writes files and a manifest, and identifies itself', async () => {
    const seen: Array<{ url: string; ua: string }> = [];
    const fetchImpl: FetchLike = (url, init) => {
      seen.push({ url, ua: init.headers['User-Agent']! });
      return Promise.resolve(ok(`<html>${url}</html>`));
    };

    const summary = await runScrape(config, {
      dataRoot,
      letters: ['क', 'ख'],
      fetchImpl,
      sleepImpl,
    });

    expect(summary).toMatchObject({ fetched: 2, skippedCached: 0 });
    expect(seen).toHaveLength(2);
    expect(seen[0]!.ua).toBe(DSAL_USER_AGENT);

    const scrapeDir = join(dataRoot, config.slug, 'scrape');
    const kIndex = config.queryAlphabet.indexOf('क');
    const file = join(scrapeDir, queryFileName(kIndex, { qs: 'क', matchtype: 'default' }));
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf-8')).toContain('molesworth_query.py');

    const manifest = loadManifest(scrapeDir);
    expect(Object.keys(manifest)).toHaveLength(2);
    const entry = Object.values(manifest)[0]!;
    expect(entry).toMatchObject({ qs: 'क', matchtype: 'default', httpStatus: 200 });
    expect(entry.sha1).toHaveLength(40);
  });

  it('applies a jittered politeness delay between consecutive requests only', async () => {
    await runScrape(config, {
      dataRoot,
      letters: ['क', 'ख', 'ग'],
      delayMs: 1000,
      fetchImpl: () => Promise.resolve(ok('<html/>')),
      sleepImpl,
    });
    // No delay before the first request; one before each of the rest.
    expect(sleeps).toHaveLength(2);
    for (const ms of sleeps) {
      expect(ms).toBeGreaterThanOrEqual(800);
      expect(ms).toBeLessThanOrEqual(1200);
    }
  });

  it('resumes: cached queries are skipped, missing ones fetched', async () => {
    const fetchImpl = vi.fn<FetchLike>(() => Promise.resolve(ok('<html/>')));
    await runScrape(config, { dataRoot, letters: ['क'], fetchImpl, sleepImpl });
    await runScrape(config, { dataRoot, letters: ['क', 'ख'], fetchImpl, sleepImpl });
    // Second run fetched only ख.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const secondUrl = fetchImpl.mock.calls[1]![0];
    expect(decodeURIComponent(secondUrl)).toContain('qs=ख');
  });

  it('re-fetches cached queries under --force', async () => {
    const fetchImpl = vi.fn<FetchLike>(() => Promise.resolve(ok('<html/>')));
    await runScrape(config, { dataRoot, letters: ['क'], fetchImpl, sleepImpl });
    const summary = await runScrape(config, {
      dataRoot,
      letters: ['क'],
      force: true,
      fetchImpl,
      sleepImpl,
    });
    expect(summary.fetched).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retries transient 5xx failures with backoff, then succeeds', async () => {
    let calls = 0;
    const fetchImpl: FetchLike = () => {
      calls += 1;
      return Promise.resolve(calls < 3 ? { status: 500, text: () => Promise.resolve('') } : ok('<html/>'));
    };
    const summary = await runScrape(config, { dataRoot, letters: ['क'], fetchImpl, sleepImpl });
    expect(summary.fetched).toBe(1);
    expect(calls).toBe(3);
    // Two backoff sleeps (5s, 10s) — exponential.
    expect(sleeps).toEqual([5000, 10000]);
  });

  it('gives up after exhausting retries', async () => {
    const fetchImpl: FetchLike = () => Promise.resolve({ status: 500, text: () => Promise.resolve('') });
    await expect(
      runScrape(config, { dataRoot, letters: ['क'], fetchImpl, sleepImpl }),
    ).rejects.toThrow(/giving up/);
  });

  it('aborts the whole run on 403/429 without retrying', async () => {
    const fetchImpl = vi.fn<FetchLike>(() =>
      Promise.resolve({ status: 429, text: () => Promise.resolve('') }),
    );
    await expect(
      runScrape(config, { dataRoot, letters: ['क', 'ख'], fetchImpl, sleepImpl }),
    ).rejects.toThrow(ScrapeAbortError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
