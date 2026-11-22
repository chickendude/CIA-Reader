import { error } from '@sveltejs/kit';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { Text } from '../db/schema.js';
import { studyFrequencies } from './study-frequencies.js';

type Book = Pick<Text, 'id' | 'language'>;

export const bookIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readBookPercent(value: string | null) {
  if (value === null) return 98;
  const pct = Number(value);
  if (!value.trim() || pct < 0 || pct > 100 || !Number.isInteger(pct * 10)) {
    throw error(400, 'Enter a percentage from 0 to 100 with up to one decimal place.');
  }
  return pct;
}

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

type SourceFrequency = Pick<Frequency, 'lemma' | 'source'>;

// Both the estimate and the deck select whole entries in frequency order, with ID breaking ties.
function knownPrefix(rows: SourceFrequency[], known: number) {
  const total = Math.round(rows.reduce((sum, row) => sum + row.source, 0));
  const threshold = total * Math.round(known * 10) / 1000;
  const ids = new Set<string>();
  let covered = 0;
  for (const row of rows) {
    if (covered + 1e-7 >= threshold) break;
    if (row.lemma && row.source > 0) {
      ids.add(row.lemma);
      covered += row.source;
    }
  }
  return { ids, total, reached: covered + 1e-7 >= threshold, maximum: total ? covered / total * 100 : 0 };
}

export async function assumedKnownWords(book: Book, sourceId: string, known: number, userId?: string) {
  if (!bookIdPattern.test(sourceId) || sourceId.toLowerCase() === book.id.toLowerCase()) throw error(400, 'Choose another book.');
  const source = sql`SELECT id FROM texts WHERE id=${sourceId} AND language=${book.language}
    AND status='ready' AND visibility='official'`;
  const rows = await db.execute<SourceFrequency>(sql`
    SELECT lemma_id AS lemma, occurrences::float8 AS source
    FROM (${studyFrequencies(source, book.language, userId)}) f ORDER BY source DESC, lemma_id
  `);
  const prefix = knownPrefix(rows, known);
  if (!prefix.total) throw error(400, 'Choose a book with vocabulary analysis in this language.');
  if (!prefix.reached) throw error(400, `Choose a known coverage of ${Math.floor(prefix.maximum * 10) / 10}% or less for this book.`);
  return prefix.ids;
}

export function estimateCoverage(rows: Frequency[], known: number, goal: number) {
  const prefix = knownPrefix(rows, known);
  const targetTotal = Math.round(rows.reduce((sum, row) => sum + row.target, 0));
  if (!prefix.total || !targetTotal) return { kind: 'unavailable' } as const;
  if (!prefix.reached) return { kind: 'source-limit', maximum: prefix.maximum } as const;

  const targetThreshold = targetTotal * Math.round(goal * 10) / 1000;
  const tolerance = 1e-7;
  let transferred = 0;
  const remaining = [];
  for (const row of rows) {
    if (row.lemma === null) continue;
    if (prefix.ids.has(row.lemma)) transferred += row.target;
    else if (row.target > 0) remaining.push(row.target);
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
