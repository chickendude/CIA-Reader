/**
 * In-memory `DictionaryRepo` for runner tests (T-3.1).
 *
 * The real repo wraps Drizzle; this one wraps three Maps. Behaviorally
 * equivalent to the extent the runner cares:
 *
 * - `insertLemma` assigns a stable synthetic UUID and stamps
 *   `created_at` / `updated_at` so the returned rows satisfy the
 *   `Lemma` type without the test suite having to produce dates.
 * - `updateLemmaFromSource` refuses to touch a curator-locked row; if
 *   the runner ever bypasses the lock check upstream, this surface
 *   will throw and the test will fail loudly — belt + suspenders.
 * - `findTranslation` / `findLemmaBySource` do linear scans, which is
 *   fine at fixture scale.
 */
import { stripNukta, type LanguageCode } from '@ciareader/shared-types';

import type { Lemma, Translation } from '../db/schema.js';

import type {
  DictionaryRepo,
  FormUpsertPayload,
  ImportRunAudit,
  LemmaLookupKey,
  LemmaUpsertPayload,
  TranslationUpsertPayload,
} from './repo.js';

type StoredForm = FormUpsertPayload & { id: string; createdAt: Date };

function nowUtc(): Date {
  return new Date();
}

let _idCounter = 0;
function nextId(prefix: string): string {
  _idCounter += 1;
  return `${prefix}-${String(_idCounter).padStart(8, '0')}`;
}

export class InMemoryDictionaryRepo implements DictionaryRepo {
  readonly lemmas = new Map<string, Lemma>();
  readonly translations = new Map<string, Translation>();
  readonly forms: StoredForm[] = [];
  readonly audit: ImportRunAudit[] = [];

  seedCuratorLocked(
    // `headwordNuktaStripped` is computed by Postgres for real rows
    // (#318); the in-memory fake mirrors that by deriving it from
    // `headword` via the shared `stripNukta` helper, so callers
    // never need to provide it.
    key: Omit<
      Lemma,
      | 'createdAt'
      | 'updatedAt'
      | 'curatorLocked'
      | 'id'
      | 'headwordNuktaStripped'
    > & {
      id?: string;
    },
  ): Lemma {
    const id = key.id ?? nextId('lemma');
    const row: Lemma = {
      id,
      language: key.language as LanguageCode,
      headword: key.headword,
      pos: key.pos,
      script: key.script,
      glossDefault: key.glossDefault,
      frequencyRank: key.frequencyRank,
      source: key.source,
      sourceAttribution: key.sourceAttribution,
      sourceId: key.sourceId,
      curatorLocked: true,
      createdAt: nowUtc(),
      updatedAt: nowUtc(),
      headwordNuktaStripped: stripNukta(key.headword),
    };
    this.lemmas.set(id, row);
    return row;
  }

  async findLemmaBySource(key: LemmaLookupKey): Promise<Lemma | null> {
    for (const row of this.lemmas.values()) {
      if (
        row.language === key.language &&
        row.source === key.source &&
        row.sourceId === key.sourceId
      ) {
        return row;
      }
    }
    return null;
  }

  async insertLemma(payload: LemmaUpsertPayload): Promise<Lemma> {
    const id = nextId('lemma');
    const row: Lemma = {
      id,
      language: payload.language,
      headword: payload.headword,
      pos: payload.pos,
      script: payload.script,
      glossDefault: payload.glossDefault ?? null,
      frequencyRank: payload.frequencyRank ?? null,
      source: payload.source,
      sourceAttribution: payload.sourceAttribution,
      sourceId: payload.sourceId,
      curatorLocked: false,
      createdAt: nowUtc(),
      updatedAt: nowUtc(),
      headwordNuktaStripped: stripNukta(payload.headword),
    };
    this.lemmas.set(id, row);
    return row;
  }

  async updateLemmaFromSource(id: string, payload: LemmaUpsertPayload): Promise<Lemma> {
    const existing = this.lemmas.get(id);
    if (!existing) throw new Error(`No lemma ${id}`);
    if (existing.curatorLocked) {
      throw new Error(
        `Runner bug: updateLemmaFromSource(${id}) called on a curator-locked row`,
      );
    }
    const next: Lemma = {
      ...existing,
      headword: payload.headword,
      pos: payload.pos,
      script: payload.script,
      glossDefault: payload.glossDefault ?? null,
      frequencyRank: payload.frequencyRank ?? null,
      sourceAttribution: payload.sourceAttribution,
      sourceId: payload.sourceId,
      updatedAt: nowUtc(),
      headwordNuktaStripped: stripNukta(payload.headword),
    };
    this.lemmas.set(id, next);
    return next;
  }

  async findTranslation(
    lemmaId: string,
    source: Translation['source'],
    sourceId: string,
  ): Promise<Translation | null> {
    for (const row of this.translations.values()) {
      // T-14.7a: legacy lemma_id field dropped — match against
      // the polymorphic target instead. The in-memory repo only
      // ever writes lemma-target rows.
      if (
        row.targetType === 'lemma' &&
        row.targetId === lemmaId &&
        row.source === source &&
        row.sourceId === sourceId
      ) {
        return row;
      }
    }
    return null;
  }

  async insertTranslation(payload: TranslationUpsertPayload): Promise<Translation> {
    const id = nextId('translation');
    const row: Translation = {
      id,
      // T-14.1 / T-14.7a: legacy lemma_id removed from Translation;
      // the in-memory fixture writes only the polymorphic pair.
      targetType: 'lemma',
      targetId: payload.lemmaId,
      source: payload.source,
      submittedBy: null,
      parentTranslationId: null,
      body: payload.body,
      targetLanguage: payload.targetLanguage,
      sourceAttribution: payload.sourceAttribution ?? null,
      sourceId: payload.sourceId,
      hidden: false,
      displayRank: null,
      createdAt: nowUtc(),
      updatedAt: nowUtc(),
    };
    this.translations.set(id, row);
    return row;
  }

  async updateTranslation(
    id: string,
    payload: TranslationUpsertPayload,
  ): Promise<Translation> {
    const existing = this.translations.get(id);
    if (!existing) throw new Error(`No translation ${id}`);
    const next: Translation = {
      ...existing,
      body: payload.body,
      targetLanguage: payload.targetLanguage,
      sourceAttribution: payload.sourceAttribution ?? null,
      sourceId: payload.sourceId,
      updatedAt: nowUtc(),
    };
    this.translations.set(id, next);
    return next;
  }

  async insertForm(payload: FormUpsertPayload): Promise<void> {
    this.forms.push({
      ...payload,
      id: nextId('form'),
      createdAt: nowUtc(),
    });
  }

  async recordImportRun(audit: ImportRunAudit): Promise<void> {
    this.audit.push(audit);
  }
}
