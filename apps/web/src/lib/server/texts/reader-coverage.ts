import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { scoreBookEntries } from './book-stats.js';
import { catalogEntries, officialCatalog } from './official-catalog.js';

function revisions(userId: string) {
  return sql`
    SELECT g.revision AS catalog, coalesce(v.revision, 0) AS vocabulary
    FROM official_coverage_generation g
    LEFT JOIN reader_vocabulary_revisions v ON v.user_id=${userId}
  `;
}

function cacheState(userId: string) {
  return sql`
    SELECT c.user_id IS NOT NULL AS populated,
      c.catalog_revision=r.catalog AND c.vocabulary_revision=r.vocabulary AS fresh
    FROM (${revisions(userId)}) r LEFT JOIN reader_coverage_cache c ON c.user_id=${userId} AND c.learning_entries IS NOT NULL
  `;
}

async function rebuild(userId: string) {
  await db.transaction(async tx => {
    // One scoring query at a time across web processes, including after restarts.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(648120, 64)`);
    const [state] = await tx.execute<{ fresh: boolean }>(cacheState(userId));
    if (state?.fresh) return;

    // The versions and all counts come from the same PostgreSQL statement snapshot.
    // An edit committed during the build leaves the saved versions behind automatically.
    await tx.execute(sql`
      WITH versions AS (${revisions(userId)}), candidates AS (${officialCatalog()}),
      entries AS (${catalogEntries}), scores AS (${scoreBookEntries(userId)}),
      packed AS (
        SELECT ARRAY(SELECT id FROM scores ORDER BY id) AS ids,
          ARRAY(SELECT words FROM scores ORDER BY id) AS words,
          ARRAY(SELECT "uniqueWords" FROM scores ORDER BY id) AS distinct_words,
          ARRAY(SELECT unresolved FROM scores ORDER BY id) AS unresolved,
          ARRAY(SELECT "knownWords" FROM scores ORDER BY id) AS known,
          ARRAY(SELECT "learningWords" FROM scores ORDER BY id) AS learning,
          ARRAY(SELECT "knownHeadwords" FROM scores ORDER BY id) AS known_entries,
          ARRAY(SELECT "learningHeadwords" FROM scores ORDER BY id) AS learning_entries
      ), layout AS (
        INSERT INTO official_coverage_layouts(revision,book_ids,words,unique_words,unresolved)
        SELECT v.catalog,p.ids,p.words,p.distinct_words,p.unresolved FROM versions v,packed p
        ON CONFLICT (revision) DO NOTHING
      )
      INSERT INTO reader_coverage_cache(user_id,catalog_revision,vocabulary_revision,known_words,learning_words,known_entries,learning_entries)
      SELECT u.id,v.catalog,v.vocabulary,p.known,p.learning,p.known_entries,p.learning_entries
      FROM versions v,packed p,users u WHERE u.id=${userId}
      ON CONFLICT (user_id) DO UPDATE SET catalog_revision=excluded.catalog_revision,
        vocabulary_revision=excluded.vocabulary_revision, known_words=excluded.known_words,
        learning_words=excluded.learning_words, known_entries=excluded.known_entries, learning_entries=excluded.learning_entries
    `);
    await tx.execute(sql`
      DELETE FROM official_coverage_layouts l WHERE l.revision < (SELECT revision FROM official_coverage_generation)
      AND NOT EXISTS (SELECT FROM reader_coverage_cache c WHERE c.catalog_revision=l.revision)
    `);
  });
}

let worker = Promise.resolve();
const queued = new Map<string, Promise<void>>();

export function refreshReaderCoverage(userId: string): Promise<void> {
  const pending = queued.get(userId);
  if (pending) return pending;
  const next = worker.then(() => rebuild(userId)).finally(() => queued.delete(userId));
  worker = next.catch(error => console.error('Official coverage refresh failed', error));
  queued.set(userId, next);
  return next;
}

export async function ensureReaderCoverage(userId: string): Promise<void> {
  const [state] = await db.execute<{ populated: boolean; fresh: boolean }>(cacheState(userId));
  if (state?.fresh) return;
  const refresh = refreshReaderCoverage(userId);
  if (!state?.populated) await refresh;
}

export function cachedBookScores(userId: string) {
  return sql`
    SELECT b.id,b.words,b.distinct_words AS "uniqueWords",b.unresolved,
      b.known AS "knownWords", b.learning AS "learningWords",
      b.known_entries AS "knownHeadwords", b.learning_entries AS "learningHeadwords",
      b.known::numeric / b.words AS reading_ratio,
      (b.known + b.learning)::numeric / b.words AS learning_ratio,
      b.known_entries::numeric / nullif(b.distinct_words,0) AS unique_ratio
    FROM reader_coverage_cache c JOIN official_coverage_layouts l ON l.revision=c.catalog_revision
    CROSS JOIN LATERAL unnest(l.book_ids,l.words,l.unique_words,l.unresolved,c.known_words,c.learning_words,c.known_entries,c.learning_entries)
      AS b(id,words,distinct_words,unresolved,known,learning,known_entries,learning_entries)
    WHERE c.user_id=${userId}
  `;
}
