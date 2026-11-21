import { sql, type SQL } from 'drizzle-orm';
import { hindiSyllableRuns, matchHindiMerges } from '$lib/dictionary/hindi-merge';
import type { DB } from '../db/index';

type Connection = Pick<DB, 'execute'>;
type Word = { idx: number; surface: string; isWord: boolean };

export function hindiMergeEntries(connection: Connection, condition: SQL, lock = false) {
  return connection.execute<{ id: string; headword: string; pos: string }>(sql`
    SELECT l.id, l.headword, l.pos FROM lemmas l JOIN dictionary_entries e ON e.lemma_id=l.id
    WHERE l.language='hi' AND (${condition})
    AND NOT coalesce(e.entry->'excluded_forms','[]') ? l.headword
    ORDER BY l.headword, l.pos, l.id ${lock ? sql`FOR SHARE` : sql``}`);
}

export async function findHindiMerges(connection: Connection, tokens: Word[]) {
  const runs = hindiSyllableRuns(tokens);
  if (!runs.length) return [];
  const prefixes = [...new Set(runs.map((run) => run.prefix))];
  const entries = await hindiMergeEntries(
    connection,
    sql.join(
      prefixes.map((prefix) => sql`l.headword LIKE ${prefix + '%'}`),
      sql` OR `,
    ),
  );
  return matchHindiMerges(runs, entries);
}
