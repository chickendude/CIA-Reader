/**
 * NLP job lifecycle helpers (T-4.4).
 *
 * Every uploaded text needs to be tokenized + lemmatized before the
 * reader can show known-words or pop-ups. The actual NLP work is an
 * arq job in services/nlp; this module is the web app's view of the
 * lifecycle:
 *
 *   - `enqueueNlpJob(textId)` — called right after upload. Inserts
 *     the bookkeeping row in `nlp_jobs` and dispatches via the
 *     pluggable `JobDispatcher`. The default dispatcher is a no-op,
 *     which is fine for tests + dev where the worker isn't running;
 *     the prod wiring (Redis push + arq pickup) lands as a
 *     dispatcher implementation in T-13.x.
 *   - `markTextProcessing` / `markTextReady` / `markTextFailed` —
 *     status transitions the worker calls back into via an admin
 *     endpoint. Mirrors the NLP service's `TextStore` contract from
 *     services/nlp/app/worker/store.py so the worker can be wired
 *     against Postgres or against a fake.
 *   - `getTextStatus(textId, viewer)` — polling endpoint backing the
 *     reader's "processing" → "ready" UX. Owner-scoped; null for
 *     anyone else (we don't leak text existence).
 */
import { desc, eq } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import type { NlpJob, Text, User } from '../db/schema.js';

/**
 * Pluggable transport for actually triggering the worker. The default
 * implementation is a no-op — fine for tests + early dev. A later
 * ticket adds a Redis-backed dispatcher that pushes onto the arq
 * queue. Keeping this an injected interface (rather than a hardcoded
 * Redis call) means tests don't need a Redis mock, and the prod
 * dispatcher can be swapped without touching upload code.
 */
export interface JobDispatcher {
  dispatch(args: { jobId: string; textId: string; chapterIds: string[] }): Promise<void>;
}

const NOOP_DISPATCHER: JobDispatcher = {
  async dispatch() {
    // Intentionally empty — see file header.
  },
};

let activeDispatcher: JobDispatcher = NOOP_DISPATCHER;

/**
 * Swap the dispatcher used by `enqueueNlpJob`. Production wiring calls
 * this once at boot with the Redis-backed implementation; tests can
 * pass a spy here.
 */
export function setJobDispatcher(d: JobDispatcher): void {
  activeDispatcher = d;
}

export function resetJobDispatcher(): void {
  activeDispatcher = NOOP_DISPATCHER;
}

export type EnqueueResult = {
  job: NlpJob;
};

/**
 * Insert a `nlp_jobs` row and tell the dispatcher to wake the worker.
 * The text's own `status` stays `pending` until the worker flips it
 * via `markTextProcessing` — splitting "queued" from "started" lets
 * the UI show "waiting in queue" vs "processing" if we add that
 * distinction later.
 */
export async function enqueueNlpJob(args: {
  textId: string;
  chapterIds: string[];
  now?: Date;
}): Promise<EnqueueResult> {
  const now = args.now ?? new Date();
  const [job] = await db
    .insert(schema.nlpJobs)
    .values({
      textId: args.textId,
      status: 'pending',
      createdAt: now,
    })
    .returning();
  if (!job) throw new Error('Failed to insert nlp_jobs row');
  await activeDispatcher.dispatch({
    jobId: (job as NlpJob).id,
    textId: args.textId,
    chapterIds: args.chapterIds,
  });
  return { job: job as NlpJob };
}

/** Worker callback: mark a text as actively being processed. */
export async function markTextProcessing(
  textId: string,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(schema.texts)
    .set({ status: 'processing', statusError: null, updatedAt: now })
    .where(eq(schema.texts.id, textId));
  await db
    .update(schema.nlpJobs)
    .set({ status: 'processing', startedAt: now })
    .where(eq(schema.nlpJobs.textId, textId));
}

/** Worker callback: tokenization succeeded. */
export async function markTextReady(
  textId: string,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(schema.texts)
    .set({ status: 'ready', statusError: null, updatedAt: now })
    .where(eq(schema.texts.id, textId));
  await db
    .update(schema.nlpJobs)
    .set({ status: 'completed', finishedAt: now })
    .where(eq(schema.nlpJobs.textId, textId));
}

/** Worker callback: tokenization failed. The error message is shown in
 * the reader's status badge, so it should be human-friendly (the
 * worker truncates long Python tracebacks to a single line). */
export async function markTextFailed(
  textId: string,
  error: string,
  now: Date = new Date(),
): Promise<void> {
  const trimmed = error.length > 1000 ? error.slice(0, 1000) + '…' : error;
  await db
    .update(schema.texts)
    .set({ status: 'failed', statusError: trimmed, updatedAt: now })
    .where(eq(schema.texts.id, textId));
  await db
    .update(schema.nlpJobs)
    .set({ status: 'failed', error: trimmed, finishedAt: now })
    .where(eq(schema.nlpJobs.textId, textId));
}

export type StatusView = {
  status: Text['status'];
  statusError: string | null;
  /** Most recent job tied to this text, or null if none was queued
   * (shouldn't happen in normal flow but the polling UI shouldn't
   * crash if it does). */
  job: NlpJob | null;
};

/**
 * Owner-scoped status lookup for the polling endpoint. Returns null
 * for non-owners + missing texts; the endpoint maps that to 404 so
 * we don't leak text existence.
 */
export async function getTextStatus(
  viewer: Pick<User, 'id'>,
  textId: string,
): Promise<StatusView | null> {
  const [text] = await db
    .select()
    .from(schema.texts)
    .where(eq(schema.texts.id, textId))
    .limit(1);
  if (!text) return null;
  if ((text as Text).ownerId !== viewer.id) return null;
  const [job] = await db
    .select()
    .from(schema.nlpJobs)
    .where(eq(schema.nlpJobs.textId, textId))
    .orderBy(desc(schema.nlpJobs.createdAt))
    .limit(1);
  return {
    status: (text as Text).status,
    statusError: (text as Text).statusError,
    job: (job as NlpJob | undefined) ?? null,
  };
}
