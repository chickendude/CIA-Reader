/**
 * Bulk dictionary snapshot for offline / local-first clients.
 *
 * The Primeran subtitle-mining extension caches the whole `eu` dictionary in
 * IndexedDB so word look-ups never hit the network. This builds that snapshot:
 * every lemma for a language plus its public (non-hidden) translations, bucketed
 * into `official` (curated / imported) and `community` (user-submitted). Personal
 * translations are viewer-private and intentionally excluded — the extension can
 * fetch those live if ever needed.
 *
 * Two flat queries + an in-memory join keep this cheap and easy to unit-test
 * against a mocked `db`. The shape is deliberately compact (short keys) because
 * the payload ships over the wire and into IndexedDB.
 */
import { and, eq } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import type { LanguageCode } from '@ciareader/shared-types';

export type ExportedTranslation = {
  body: string;
  /** Definition language (`translations.target_language`), e.g. 'en' | 'es'. */
  lang: string;
  /** 'official' = curated/imported dictionary; 'community' = user-submitted. */
  kind: 'official' | 'community';
};

export type ExportedLemma = {
  id: string;
  headword: string;
  pos: string;
  gloss: string | null;
  /** Global frequency rank (1 = most frequent); null when unranked. */
  freq: number | null;
  translations: ExportedTranslation[];
};

export type DictionaryExport = {
  language: LanguageCode;
  count: number;
  lemmas: ExportedLemma[];
};

export async function buildDictionaryExport(
  language: LanguageCode,
): Promise<DictionaryExport> {
  const lemmaRows = await db
    .select({
      id: schema.lemmas.id,
      headword: schema.lemmas.headword,
      pos: schema.lemmas.pos,
      gloss: schema.lemmas.glossDefault,
      freq: schema.lemmas.frequencyRank,
    })
    .from(schema.lemmas)
    .where(eq(schema.lemmas.language, language));

  const translationRows = await db
    .select({
      targetId: schema.translations.targetId,
      body: schema.translations.body,
      lang: schema.translations.targetLanguage,
      source: schema.translations.source,
    })
    .from(schema.translations)
    .innerJoin(schema.lemmas, eq(schema.translations.targetId, schema.lemmas.id))
    .where(
      and(
        eq(schema.translations.targetType, 'lemma'),
        eq(schema.lemmas.language, language),
        eq(schema.translations.hidden, false),
        // The export is viewer-agnostic (shared offline snapshot), so no
        // private note ever belongs in it.
        eq(schema.translations.isPrivate, false),
      ),
    );

  const byLemma = new Map<string, ExportedTranslation[]>();
  for (const t of translationRows) {
    const kind: ExportedTranslation['kind'] =
      t.source === 'official_dictionary' || t.source === 'curator'
        ? 'official'
        : 'community';
    const list = byLemma.get(t.targetId) ?? [];
    list.push({ body: t.body, lang: t.lang, kind });
    byLemma.set(t.targetId, list);
  }

  const lemmas: ExportedLemma[] = lemmaRows.map((l) => ({
    id: l.id,
    headword: l.headword,
    pos: l.pos,
    gloss: l.gloss,
    freq: l.freq,
    translations: byLemma.get(l.id) ?? [],
  }));

  return { language, count: lemmas.length, lemmas };
}
