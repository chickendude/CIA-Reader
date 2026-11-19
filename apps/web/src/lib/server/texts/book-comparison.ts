import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { Text } from '../db/schema.js';

type Book = Pick<Text, 'id' | 'language'>;

export function listComparisonBooks(book: Book) {
  const { texts } = schema;
  return db.select({ id: texts.id, title: texts.title }).from(texts)
    .where(and(eq(texts.visibility, 'official'), eq(texts.status, 'ready'),
      eq(texts.language, book.language), ne(texts.id, book.id)))
    .orderBy(asc(texts.title), asc(texts.id));
}

type Frequency = { lemma: string | null; source: number; target: number };

export async function compareBooks(book: Book, sourceId: string, known: number, goal: number) {
  const rows = await db.execute<Frequency>(sql`
    SELECT o.lemma_id AS lemma, coalesce(sum(o.occurrences) FILTER (WHERE t.id = ${sourceId}),0)::int AS source,
      coalesce(sum(o.occurrences) FILTER (WHERE t.id = ${book.id}),0)::int AS target
    FROM texts t JOIN book_word_frequencies o ON o.text_id = t.id
    WHERE t.id IN (${book.id}, ${sourceId}) AND t.visibility = 'official'
      AND t.language = ${book.language} AND t.status = 'ready'
    GROUP BY o.lemma_id
    ORDER BY source DESC, o.lemma_id
  `);
  return estimateCoverage(rows, known, goal);
}

// Rows are ranked by source frequency, with dictionary ID breaking ties consistently.
export function estimateCoverage(rows: Frequency[], known: number, goal: number) {
  let sourceTotal = 0;
  let targetTotal = 0;
  for (const row of rows) {
    sourceTotal += row.source;
    targetTotal += row.target;
  }
  if (!sourceTotal || !targetTotal) return { kind: 'unavailable' } as const;

  // Inputs have one decimal place. Compare integer occurrence thresholds before rounding for display.
  const sourceThreshold = Math.ceil(sourceTotal * Math.round(known * 10) / 1000);
  const targetThreshold = Math.ceil(targetTotal * Math.round(goal * 10) / 1000);
  let sourceCovered = 0;
  let transferred = 0;
  const remaining = [];
  for (const row of rows) {
    if (row.lemma === null) continue;
    if (sourceCovered < sourceThreshold && row.source > 0) {
      sourceCovered += row.source;
      transferred += row.target;
    } else if (row.target > 0) {
      remaining.push(row.target);
    }
  }
  if (sourceCovered < sourceThreshold) {
    return { kind: 'source-limit', maximum: sourceCovered / sourceTotal * 100 } as const;
  }

  let covered = transferred;
  let additionalWords = 0;
  for (const frequency of remaining.sort((a, b) => b - a)) {
    if (covered >= targetThreshold) break;
    covered += frequency;
    additionalWords++;
  }
  return {
    kind: 'estimate',
    coverage: transferred / targetTotal * 100,
    additionalWords: covered >= targetThreshold ? additionalWords : null,
    maximum: covered / targetTotal * 100,
  } as const;
}
