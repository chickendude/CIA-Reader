/**
 * Drizzle-backed `DictionaryRepo` (T-3.1).
 *
 * Production counterpart to `InMemoryDictionaryRepo`. The shape mirrors
 * the test fake exactly — the import runner can't tell which one it's
 * holding. Per-method notes on invariants inline.
 */
import { and, eq } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';

import { dictionaryImports, lemmaForms, lemmas, translations } from '../db/schema.js';
import type { Lemma, Translation } from '../db/schema.js';

import type {
  DictionaryRepo,
  FormUpsertPayload,
  ImportRunAudit,
  LemmaLookupKey,
  LemmaUpsertPayload,
  TranslationUpsertPayload,
} from './repo.js';

// `PgDatabase` is generic over dialect + driver; we only care about the
// schema-typed surface the runner needs. Narrowing via `any` here keeps
// the runner decoupled from whichever postgres-js / node-postgres driver
// the caller wired.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = PgDatabase<any, any, any>;

export class DrizzleDictionaryRepo implements DictionaryRepo {
  constructor(private readonly db: DrizzleDb) {}

  async findLemmaBySource(key: LemmaLookupKey): Promise<Lemma | null> {
    const rows = await this.db
      .select()
      .from(lemmas)
      .where(
        and(
          eq(lemmas.language, key.language),
          eq(lemmas.source, key.source),
          eq(lemmas.sourceId, key.sourceId),
        ),
      )
      .limit(1);
    return (rows[0] as Lemma | undefined) ?? null;
  }

  async insertLemma(payload: LemmaUpsertPayload): Promise<Lemma> {
    const [row] = await this.db
      .insert(lemmas)
      .values({
        language: payload.language,
        headword: payload.headword,
        pos: payload.pos,
        script: payload.script,
        glossDefault: payload.glossDefault,
        frequencyRank: payload.frequencyRank,
        source: payload.source,
        sourceAttribution: payload.sourceAttribution,
        sourceId: payload.sourceId,
      })
      .returning();
    return row as Lemma;
  }

  async updateLemmaFromSource(id: string, payload: LemmaUpsertPayload): Promise<Lemma> {
    // Guard: the runner already checks curatorLocked, but if this ever
    // gets called directly we want the constraint enforced at the SQL
    // layer so a bug upstream can't quietly overwrite a curator edit.
    const [row] = await this.db
      .update(lemmas)
      .set({
        headword: payload.headword,
        pos: payload.pos,
        script: payload.script,
        glossDefault: payload.glossDefault,
        frequencyRank: payload.frequencyRank,
        sourceAttribution: payload.sourceAttribution,
        sourceId: payload.sourceId,
        updatedAt: new Date(),
      })
      .where(and(eq(lemmas.id, id), eq(lemmas.curatorLocked, false)))
      .returning();
    if (!row) {
      throw new Error(
        `Refused to update lemma ${id}: row is curator_locked or missing`,
      );
    }
    return row as Lemma;
  }

  async findTranslation(
    lemmaId: string,
    source: Translation['source'],
    sourceId: string,
  ): Promise<Translation | null> {
    const rows = await this.db
      .select()
      .from(translations)
      .where(
        and(
          eq(translations.lemmaId, lemmaId),
          eq(translations.source, source),
          eq(translations.sourceId, sourceId),
        ),
      )
      .limit(1);
    return (rows[0] as Translation | undefined) ?? null;
  }

  async insertTranslation(payload: TranslationUpsertPayload): Promise<Translation> {
    const [row] = await this.db
      .insert(translations)
      .values({
        lemmaId: payload.lemmaId,
        // T-14.1: importer-driven inserts are lemma-target. Phrase
        // imports go through the phrase service (T-14.5 NLP path).
        targetType: 'lemma',
        targetId: payload.lemmaId,
        source: payload.source,
        body: payload.body,
        targetLanguage: payload.targetLanguage,
        sourceAttribution: payload.sourceAttribution,
        sourceId: payload.sourceId,
      })
      .returning();
    return row as Translation;
  }

  async updateTranslation(
    id: string,
    payload: TranslationUpsertPayload,
  ): Promise<Translation> {
    const [row] = await this.db
      .update(translations)
      .set({
        body: payload.body,
        targetLanguage: payload.targetLanguage,
        sourceAttribution: payload.sourceAttribution,
        sourceId: payload.sourceId,
        updatedAt: new Date(),
      })
      .where(eq(translations.id, id))
      .returning();
    if (!row) throw new Error(`Translation ${id} not found for update`);
    return row as Translation;
  }

  async insertForm(payload: FormUpsertPayload): Promise<void> {
    await this.db.insert(lemmaForms).values({
      lemmaId: payload.lemmaId,
      surface: payload.surface,
      features: payload.features,
      romanization: payload.romanization,
    });
  }

  async recordImportRun(audit: ImportRunAudit): Promise<void> {
    await this.db.insert(dictionaryImports).values({
      sourceName: audit.sourceName,
      language: audit.language,
      lemmasCreated: audit.lemmasCreated,
      lemmasUpdated: audit.lemmasUpdated,
      lemmasSkippedCuratorLocked: audit.lemmasSkippedCuratorLocked,
      translationsCreated: audit.translationsCreated,
      translationsUpdated: audit.translationsUpdated,
      notes: audit.notes,
    });
  }
}
