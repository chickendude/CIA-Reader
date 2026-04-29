/**
 * Vocabulary export (T-10.3).
 *
 * Pulls every lemma the user has touched in one language and projects it to
 * Anki-friendly CSV rows: headword, POS, gloss, and learning status.
 */
import { and, asc, eq } from 'drizzle-orm';

import { db, schema } from './db/index.js';
import type { LanguageCode } from '@ciareader/shared-types';

export type VocabularyStatus = 'unknown' | 'learning' | 'known' | 'ignored';

export type VocabularyRow = {
  headword: string;
  pos: string;
  gloss: string;
  status: VocabularyStatus;
};

export async function getVocabularyForExport(
  userId: string,
  language: LanguageCode,
): Promise<VocabularyRow[]> {
  const rows = await db
    .select({
      headword: schema.lemmas.headword,
      pos: schema.lemmas.pos,
      glossDefault: schema.lemmas.glossDefault,
      status: schema.userKnownLemmas.status,
    })
    .from(schema.userKnownLemmas)
    .innerJoin(
      schema.lemmas,
      eq(schema.lemmas.id, schema.userKnownLemmas.lemmaId),
    )
    .where(
      and(
        eq(schema.userKnownLemmas.userId, userId),
        eq(schema.lemmas.language, language),
      ),
    )
    .orderBy(asc(schema.lemmas.headword), asc(schema.lemmas.pos));

  return rows.map((r) => ({
    headword: r.headword,
    pos: r.pos,
    gloss: r.glossDefault ?? '',
    status: r.status,
  }));
}

export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function rowsToCsv(rows: VocabularyRow[]): string {
  const lines = ['headword,pos,gloss,status'];
  for (const row of rows) {
    lines.push(
      [
        csvEscape(row.headword),
        csvEscape(row.pos),
        csvEscape(row.gloss),
        csvEscape(row.status),
      ].join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}
