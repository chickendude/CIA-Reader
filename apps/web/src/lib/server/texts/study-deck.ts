import type { LanguageCode } from '@ciareader/shared-types';
import { studyFrequencies } from './study-frequencies.js';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import type { StudyBand, StudyEntry } from '$lib/library/study-deck.js';

type DeckRow = StudyEntry & { matches: number; id: string | null; word: string | null; pos: string | null; definition: string | null };

export function officialDeckRows(book: { id: string; language: LanguageCode }, userId?: string) {
  const books = sql`SELECT id FROM texts WHERE id = ${book.id} AND visibility = 'official' AND language = ${book.language}`;
  return db.execute<DeckRow>(sql`
    WITH matches AS (${studyFrequencies(books, book.language, userId)}), frequencies AS (
      SELECT lemma_id, sum(occurrences)::float8 AS frequency, sum(matches)::int AS matches
      FROM matches GROUP BY lemma_id
    )
    SELECT l.id, l.headword AS word, l.pos, l.gloss_default AS definition, f.frequency, f.matches,
      CASE WHEN l.id IS NULL THEN 'unresolved' ELSE coalesce(k.status::text, 'unknown') END AS status,
      coalesce(l.pos = 'PROPN', false) AS proper,
      coalesce((h.entry->>'english_loan')::boolean, EXISTS (
        SELECT 1 FROM hindi_reference_cache WHERE key = 'loan:' || h.lemma_id
      )) AS loan
    FROM frequencies f LEFT JOIN lemmas l ON l.id = f.lemma_id
    LEFT JOIN user_known_lemmas k ON k.lemma_id = l.id AND k.user_id = ${userId ?? null}::uuid
    LEFT JOIN hindi_entries h ON h.lemma_id = l.id
    ORDER BY f.frequency DESC, l.headword, l.pos, l.id
  `);
}

export function studyBands(rows: StudyEntry[]): StudyBand[] {
  const bands = new Map<string, StudyBand>();
  for (const { frequency, status, proper, loan } of rows) {
    const key = [frequency, status, proper, loan].join(':');
    const band = bands.get(key);
    if (band) band.entries++;
    else bands.set(key, { frequency, status, proper, loan, entries: 1 });
  }
  return [...bands.values()];
}
