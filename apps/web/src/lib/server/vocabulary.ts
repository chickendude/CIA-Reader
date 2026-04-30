/**
 * Vocabulary export (T-10.3, T-14.6).
 *
 * Pulls every lemma AND phrase the user has touched in one language
 * and projects them to Anki-friendly CSV rows: kind ("lemma" /
 * "phrase"), headword (joined surfaces for phrases), POS, gloss,
 * status. The `kind` column lets a learner filter the export into
 * separate decks if they prefer single-word and multi-word cards
 * apart.
 */
import { and, asc, eq } from 'drizzle-orm';

import { db, schema } from './db/index.js';
import type { LanguageCode } from '@ciareader/shared-types';

export type VocabularyStatus = 'unknown' | 'learning' | 'known' | 'ignored';
export type VocabularyKind = 'lemma' | 'phrase';

export type VocabularyRow = {
  /** T-14.6: discriminator between single-word lemma rows and
   *  multi-word phrase rows. */
  kind: VocabularyKind;
  /** Lemma headword for `kind='lemma'`; phrase
   *  `surface_normalised` (joined surfaces, single-spaced) for
   *  `kind='phrase'`. */
  headword: string;
  /** POS for lemmas; phrase `pos` (typically 'VERB' for conjunct
   *  verbs, empty otherwise) for phrases. */
  pos: string;
  gloss: string;
  status: VocabularyStatus;
};

export async function getVocabularyForExport(
  userId: string,
  language: LanguageCode,
): Promise<VocabularyRow[]> {
  // Lemma rows — unchanged from T-10.3.
  const lemmaRows = await db
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

  // T-14.6: phrase rows. Same shape as lemma rows; the `kind`
  // discriminator + the phrase's `surface_normalised` (already
  // NFC-joined by createPhrase) lets the export look like a
  // multi-word entry to whatever flashcard tool the user pipes
  // it into.
  const phraseRows = await db
    .select({
      surfaceNormalised: schema.phrases.surfaceNormalised,
      pos: schema.phrases.pos,
      glossDefault: schema.phrases.glossDefault,
      status: schema.userKnownPhrases.status,
    })
    .from(schema.userKnownPhrases)
    .innerJoin(
      schema.phrases,
      eq(schema.phrases.id, schema.userKnownPhrases.phraseId),
    )
    .where(
      and(
        eq(schema.userKnownPhrases.userId, userId),
        eq(schema.phrases.language, language),
      ),
    )
    .orderBy(asc(schema.phrases.surfaceNormalised));

  const lemmaOut: VocabularyRow[] = lemmaRows.map((r) => ({
    kind: 'lemma',
    headword: r.headword,
    pos: r.pos,
    gloss: r.glossDefault ?? '',
    status: r.status,
  }));
  const phraseOut: VocabularyRow[] = phraseRows.map((r) => ({
    kind: 'phrase',
    headword: r.surfaceNormalised,
    // Phrases may have a null POS; export an empty string so the
    // CSV stays rectangular.
    pos: r.pos ?? '',
    gloss: r.glossDefault ?? '',
    status: r.status,
  }));
  return [...lemmaOut, ...phraseOut];
}

export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function rowsToCsv(rows: VocabularyRow[]): string {
  // T-14.6: leading `kind` column lets the export reader split
  // the file into per-kind decks. Existing T-10.3 consumers that
  // ignore unknown columns will still see headword/pos/gloss/
  // status in the same order.
  const lines = ['kind,headword,pos,gloss,status'];
  for (const row of rows) {
    lines.push(
      [
        csvEscape(row.kind),
        csvEscape(row.headword),
        csvEscape(row.pos),
        csvEscape(row.gloss),
        csvEscape(row.status),
      ].join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}
