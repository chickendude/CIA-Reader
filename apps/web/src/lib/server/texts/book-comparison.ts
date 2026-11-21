import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { Text } from '../db/schema.js';
import { studyFrequencies } from './study-frequencies.js';

type Book = Pick<Text, 'id' | 'language'>;

export function listComparisonBooks(book: Book) {
  const { texts } = schema;
  return db.select({ id: texts.id, title: texts.title }).from(texts)
    .where(and(eq(texts.visibility, 'official'), eq(texts.status, 'ready'),
      eq(texts.language, book.language), ne(texts.id, book.id)))
    .orderBy(asc(texts.title), asc(texts.id));
}

type Frequency = { lemma: string | null; source: number; target: number };

export async function compareBooks(book: Book, sourceId: string, known: number, goal: number, userId?: string) {
  const books = sql`
    SELECT id FROM texts WHERE id IN (${book.id}, ${sourceId}) AND visibility = 'official'
      AND language = ${book.language} AND status = 'ready'
  `;
  const rows = await db.execute<Frequency>(sql`
    WITH frequencies AS (${studyFrequencies(books, book.language, userId)})
    SELECT lemma_id AS lemma, coalesce(sum(occurrences) FILTER (WHERE text_id = ${sourceId}), 0)::float8 AS source,
      coalesce(sum(occurrences) FILTER (WHERE text_id = ${book.id}), 0)::float8 AS target
    FROM frequencies GROUP BY lemma_id ORDER BY source DESC, lemma_id
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
  // Ambiguous readings split a word's weight equally. The book totals are whole words.
  sourceTotal = Math.round(sourceTotal);
  targetTotal = Math.round(targetTotal);
  if (!sourceTotal || !targetTotal) return { kind: 'unavailable' } as const;

  const sourceThreshold = sourceTotal * Math.round(known * 10) / 1000;
  const targetThreshold = targetTotal * Math.round(goal * 10) / 1000;
  // Summing fractional frequencies can leave a tiny residue at an exact threshold.
  const tolerance = 1e-7;
  let sourceCovered = 0;
  let transferred = 0;
  const remaining = [];
  for (const row of rows) {
    if (row.lemma === null) continue;
    if (sourceCovered + tolerance < sourceThreshold && row.source > 0) {
      sourceCovered += row.source;
      transferred += row.target;
    } else if (row.target > 0) {
      remaining.push(row.target);
    }
  }
  if (sourceCovered + tolerance < sourceThreshold) {
    return { kind: 'source-limit', maximum: sourceCovered / sourceTotal * 100 } as const;
  }

  let covered = transferred;
  let additionalWords = 0;
  for (const frequency of remaining.sort((a, b) => b - a)) {
    if (covered + tolerance >= targetThreshold) break;
    covered += frequency;
    additionalWords++;
  }
  return {
    kind: 'estimate',
    coverage: transferred / targetTotal * 100,
    additionalWords: covered + tolerance >= targetThreshold ? additionalWords : null,
    maximum: covered / targetTotal * 100,
  } as const;
}
