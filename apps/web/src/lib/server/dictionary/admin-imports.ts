/**
 * Server-side helpers for the admin dictionary-sources page (T-3.14).
 *
 * Three responsibilities:
 *
 *  1. Probe each registered source's on-disk cache state
 *     (`apps/web/data/dictionaries/<slug>/raw.jsonl`) without loading
 *     the file — multi-GB Kaikki dumps would OOM otherwise. The cache
 *     status returned by `getDictionaryCacheStatus` is what the page
 *     renders in each row's "Raw cache" column.
 *  2. Aggregate the per-source view: cache status + last
 *     `dictionary_imports` row + current contribution (lemma /
 *     translation row counts where `source = <slug>`). This shape is
 *     what the page loader serializes.
 *  3. Track and trigger background fetch + import jobs. The original
 *     ticket pitched BullMQ + Redis; the codebase doesn't have a
 *     queue at MVP (only a no-op `JobDispatcher` for NLP), so we use
 *     a module-local Map of in-flight Promises. Single web replica
 *     in prod, single process in dev — fine for now. The page polls
 *     `getActiveJob(slug)` to decide when to refresh; no Redis hop.
 *
 * Errors during a triggered import write a `failed` row to
 * `dictionary_imports` with the message, so the UI's "Last import"
 * cell can show the error without us inventing a parallel store.
 */
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { desc, eq, sql } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import type { DictionaryImport } from '../db/schema.js';

import { dictionarySources } from './sources/index.js';
import type { RegistryEntry } from './sources/index.js';
import { DrizzleDictionaryRepo } from './drizzle-repo.js';
import { runDictionaryImport } from './runner.js';

const APPS_WEB_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../',
);

const DATA_ROOT = resolve(APPS_WEB_ROOT, 'data', 'dictionaries');

export type CacheState = 'cached' | 'partial' | 'missing';

export type DictionaryCacheStatus = {
  slug: string;
  /** Absolute path to the canonical `raw.jsonl`. Always set, even when missing. */
  rawPath: string;
  /** True iff `raw.jsonl` exists and is non-empty. */
  exists: boolean;
  /** True iff `raw.jsonl.tmp` exists — a stalled or in-flight transfer. */
  hasPartial: boolean;
  /**
   * Coarse cache state for the UI. `partial` wins over `missing`
   * because a `.tmp` without a final file means a fetch was started
   * and didn't complete — the curator should know that, not just see
   * "missing".
   */
  state: CacheState;
  sizeBytes: number | null;
  lineCount: number | null;
  mtime: Date | null;
};

/**
 * `wc -l` equivalent that doesn't load the file. Counts `\n` bytes in
 * a stream so a 3 GB Kaikki dump is fine — we still pay the disk read,
 * but RSS stays flat. Returns 0 for an empty file (matches `wc -l`).
 */
async function countLines(path: string): Promise<number> {
  return new Promise((resolveLines, rejectLines) => {
    let lines = 0;
    const stream = createReadStream(path);
    stream.on('data', (chunk: Buffer | string) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      for (let i = 0; i < buf.length; i += 1) {
        if (buf[i] === 0x0a) lines += 1;
      }
    });
    stream.on('error', rejectLines);
    stream.on('end', () => resolveLines(lines));
  });
}

/**
 * Probe the on-disk cache for one slug. Reads stats + line count of
 * `raw.jsonl`, plus a stat-only check on `raw.jsonl.tmp` so the UI can
 * surface "interrupted fetch — re-run to finish".
 */
export async function getDictionaryCacheStatus(
  slug: string,
  rootDir: string = DATA_ROOT,
): Promise<DictionaryCacheStatus> {
  const rawPath = resolve(rootDir, slug, 'raw.jsonl');
  const tmpPath = `${rawPath}.tmp`;

  let exists = false;
  let sizeBytes: number | null = null;
  let mtime: Date | null = null;
  let lineCount: number | null = null;
  try {
    const s = await stat(rawPath);
    if (s.size > 0) {
      exists = true;
      sizeBytes = s.size;
      mtime = s.mtime;
      lineCount = await countLines(rawPath);
    }
  } catch (e) {
    if (!isNotFound(e)) throw e;
  }

  let hasPartial = false;
  try {
    const s = await stat(tmpPath);
    if (s.size > 0) hasPartial = true;
  } catch (e) {
    if (!isNotFound(e)) throw e;
  }

  const state: CacheState = exists ? 'cached' : hasPartial ? 'partial' : 'missing';
  return { slug, rawPath, exists, hasPartial, state, sizeBytes, lineCount, mtime };
}

function isNotFound(e: unknown): boolean {
  return (
    typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === 'ENOENT'
  );
}

export type SourceContributionCounts = {
  lemmas: number;
  translations: number;
};

/**
 * Count rows currently sourced from `slug` in `lemmas` and
 * `translations`. The schema doesn't carry the registry slug, so we
 * filter by `source_attribution` — every registered importer uses a
 * distinct attribution string, so the count is exact in practice.
 *
 * Both columns are checked directly: lemmas attributed to the source
 * (e.g. kaikki-hindi creates lemmas + translations both attributed to
 * "Wiktionary Hindi via Kaikki.org"), and translations attributed to
 * the source (e.g. kaikki-en-translations-hindi creates *only*
 * translations on lemmas that already exist from another importer —
 * those translations carry the en-translations attribution, the
 * lemmas don't).
 */
export async function getSourceContribution(
  slug: string,
): Promise<SourceContributionCounts> {
  const entry = dictionarySources.find((e) => e.name === slug);
  if (!entry) return { lemmas: 0, translations: 0 };

  const attribution = entry.source.sourceAttribution;

  const [lemmaRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.lemmas)
    .where(eq(schema.lemmas.sourceAttribution, attribution));

  const [translationRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.translations)
    .where(eq(schema.translations.sourceAttribution, attribution));

  return {
    lemmas: lemmaRow?.count ?? 0,
    translations: translationRow?.count ?? 0,
  };
}

export async function getLastImport(slug: string): Promise<DictionaryImport | null> {
  const rows = await db
    .select()
    .from(schema.dictionaryImports)
    .where(eq(schema.dictionaryImports.sourceName, slug))
    .orderBy(desc(schema.dictionaryImports.runAt))
    .limit(1);
  return (rows[0] as DictionaryImport | undefined) ?? null;
}

// ─── Job tracking ────────────────────────────────────────────────────

export type JobKind = 'fetch' | 'import';
export type JobStatus = 'running' | 'failed' | 'done';

export type ActiveJob = {
  slug: string;
  kind: JobKind;
  status: JobStatus;
  startedAt: Date;
  finishedAt: Date | null;
  triggeredByUserId: string;
  errorMessage: string | null;
};

/**
 * Module-local registry of in-flight (and recently finished) jobs.
 * Keyed by slug so a row's "Re-fetch" + "Re-import" buttons can't
 * stack two jobs on the same source — the second click sees a
 * `running` status and is a no-op (the action returns immediately).
 *
 * Finished jobs live in the map for `JOB_RETENTION_MS` after they
 * resolve so the polling UI can show "completed at hh:mm" before the
 * row reverts to its idle state. After that, the map is pruned and
 * the page falls back to the persisted `dictionary_imports` row.
 */
const activeJobs = new Map<string, ActiveJob>();
const JOB_RETENTION_MS = 60_000;

export function getActiveJob(slug: string): ActiveJob | null {
  const job = activeJobs.get(slug);
  if (!job) return null;
  if (
    job.status !== 'running' &&
    job.finishedAt &&
    Date.now() - job.finishedAt.getTime() > JOB_RETENTION_MS
  ) {
    activeJobs.delete(slug);
    return null;
  }
  return job;
}

export function listActiveJobs(): ActiveJob[] {
  return [...activeJobs.values()];
}

/** Test seam: clear the in-flight map (don't cancel anything). */
export function _resetActiveJobsForTest(): void {
  activeJobs.clear();
}

class JobAlreadyRunningError extends Error {
  constructor(public readonly slug: string) {
    super(`A job is already running for ${slug}`);
    this.name = 'JobAlreadyRunningError';
  }
}

export { JobAlreadyRunningError };

/**
 * Find the registry entry, throwing if the slug isn't registered.
 * Centralized so every action surface gives the same error shape.
 */
export function requireSource(slug: string): RegistryEntry {
  const entry = dictionarySources.find((e) => e.name === slug);
  if (!entry) throw new Error(`Unknown dictionary source: ${slug}`);
  return entry;
}

function startJob(slug: string, kind: JobKind, triggeredByUserId: string): ActiveJob {
  const existing = activeJobs.get(slug);
  if (existing && existing.status === 'running') {
    throw new JobAlreadyRunningError(slug);
  }
  const job: ActiveJob = {
    slug,
    kind,
    status: 'running',
    startedAt: new Date(),
    finishedAt: null,
    triggeredByUserId,
    errorMessage: null,
  };
  activeJobs.set(slug, job);
  return job;
}

function finishJob(slug: string, error: Error | null): void {
  const job = activeJobs.get(slug);
  if (!job) return;
  job.status = error ? 'failed' : 'done';
  job.finishedAt = new Date();
  job.errorMessage = error ? truncate(error.message) : null;
}

function truncate(s: string, max = 500): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// ─── Triggers ────────────────────────────────────────────────────────

export type TriggerOpts = { triggeredByUserId: string };

/**
 * Kick off a re-fetch by spawning the existing
 * `scripts/fetch-dictionary-sources.sh <slug> --force`. Returns
 * immediately; the caller polls `getActiveJob(slug)`. We shell out
 * (rather than re-implementing curl in TS) so the script stays the
 * single source of truth for upstream URLs and resume logic.
 *
 * Sources without a case in the script (currently the kaikki-* family
 * is the only set wired up) will surface the script's "unknown
 * source" error in the failed-job message.
 */
export function triggerFetch(slug: string, opts: TriggerOpts): ActiveJob {
  requireSource(slug);
  const job = startJob(slug, 'fetch', opts.triggeredByUserId);
  void runFetchInBackground(slug);
  return job;
}

async function runFetchInBackground(slug: string): Promise<void> {
  try {
    await new Promise<void>((resolveFetch, rejectFetch) => {
      const proc = spawn(
        'bash',
        ['scripts/fetch-dictionary-sources.sh', slug, '--force'],
        { cwd: APPS_WEB_ROOT, env: { ...process.env, FORCE: '1' } },
      );
      let stderr = '';
      proc.stderr.on('data', (d: Buffer) => {
        stderr += d.toString();
      });
      proc.on('error', rejectFetch);
      proc.on('close', (code) => {
        if (code === 0) resolveFetch();
        else rejectFetch(new Error(stderr.trim() || `fetch exited with code ${code}`));
      });
    });
    finishJob(slug, null);
  } catch (e) {
    finishJob(slug, e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Kick off a re-import from the cached `raw.jsonl`. Returns
 * immediately; the iterator runs in the background and writes a
 * `dictionary_imports` audit row on completion (succeeded or failed).
 */
export function triggerImport(slug: string, opts: TriggerOpts): ActiveJob {
  requireSource(slug);
  const job = startJob(slug, 'import', opts.triggeredByUserId);
  void runImportInBackground(slug, opts);
  return job;
}

async function runImportInBackground(slug: string, opts: TriggerOpts): Promise<void> {
  const entry = requireSource(slug);
  const repo = new DrizzleDictionaryRepo(db);
  try {
    await runDictionaryImport(repo, entry.source, {
      triggeredByUserId: opts.triggeredByUserId,
    });
    finishJob(slug, null);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    // Persist a failed audit row so the page can surface the error
    // even after JOB_RETENTION_MS elapses.
    try {
      await repo.recordImportRun({
        sourceName: entry.source.name,
        language: entry.source.language,
        lemmasCreated: 0,
        lemmasUpdated: 0,
        lemmasSkippedCuratorLocked: 0,
        translationsCreated: 0,
        translationsUpdated: 0,
        triggeredByUserId: opts.triggeredByUserId,
        status: 'failed',
        errorMessage: truncate(err.message),
      });
    } catch {
      // If the failure-row write itself fails (DB down etc.), the
      // in-memory `activeJobs` entry still carries the error for
      // the polling window — that's the best we can do.
    }
    finishJob(slug, err);
  }
}

// ─── Page snapshot ───────────────────────────────────────────────────

export type SourceRow = {
  slug: string;
  language: string;
  attribution: string;
  license: string;
  cache: DictionaryCacheStatus;
  contribution: SourceContributionCounts;
  lastImport: DictionaryImport | null;
  activeJob: ActiveJob | null;
};

export async function listSourceStatuses(
  rootDir: string = DATA_ROOT,
): Promise<SourceRow[]> {
  const rows: SourceRow[] = [];
  for (const entry of dictionarySources) {
    const [cache, lastImport, contribution] = await Promise.all([
      getDictionaryCacheStatus(entry.name, rootDir),
      getLastImport(entry.name),
      getSourceContribution(entry.name),
    ]);
    rows.push({
      slug: entry.name,
      language: entry.source.language,
      attribution: entry.source.sourceAttribution,
      license: entry.source.license,
      cache,
      contribution,
      lastImport,
      activeJob: getActiveJob(entry.name),
    });
  }
  return rows;
}

/**
 * `Delete cache` action — `unlink` the canonical `raw.jsonl`. The
 * `.tmp` sibling, if any, is left alone so a stalled fetch can be
 * inspected; the next forced fetch will overwrite it.
 */
export async function deleteCache(
  slug: string,
  rootDir: string = DATA_ROOT,
): Promise<void> {
  requireSource(slug);
  const path = resolve(rootDir, slug, 'raw.jsonl');
  try {
    await unlink(path);
  } catch (e) {
    if (!isNotFound(e)) throw e;
  }
}
