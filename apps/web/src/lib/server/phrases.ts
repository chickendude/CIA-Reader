/**
 * Phrase service (T-14.1, M14 phrase-level translations).
 *
 * Multi-word dictionary entries — the moral parallel to `lemmas` for
 * units like Hindi `इंतज़ार करना` ("to wait"), Marathi `मदत करणे`, or
 * fixed expressions like `के बारे में`. Three sources author phrases:
 * users (multi-token select in the reader, T-14.3), curators (the
 * dictionary editor, T-14.4), and the NLP rule-based detector (T-14.5).
 *
 * Identity is the ordered `phrase_tokens` rows. `surface_normalised`
 * on `phrases` is just the dedupe lookup column — see `normalizeTokens`
 * for how it's derived. Per-source duplication is allowed by design
 * (mirrors lemmas merge story from T-3.10); the curator merge UI in
 * T-14.7 reconciles duplicates.
 *
 * MVP matching is contiguous-only — discontinuous (gappy) phrases like
 * `इंतज़ार ... किया` (split by an intervening adverb) are an explicit
 * follow-up. The schema is shaped so that change is a resolver-only
 * change with no migration.
 */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { db, schema } from './db/index.js';
import type {
  Phrase,
  PhraseToken,
  Translation,
  UserKnownPhrase,
} from './db/schema.js';
import type { LanguageCode } from '@ciareader/shared-types';

// -----------------------------------------------------------------------
// Bounds (chosen to match `submitUserTranslation` ergonomics).
// -----------------------------------------------------------------------

/** Maximum tokens per phrase. Curators bypass this (rationale: a 9+
 *  token idiom like a proverbs entry is a curator-only artefact —
 *  user-created phrases stay learner-sized). */
export const MAX_PHRASE_TOKENS = 8;

/** Minimum tokens. A "phrase" of length 1 is just a lemma; reject so
 *  the data model doesn't pick up shadow entries that should have
 *  been written to `lemmas` instead. */
export const MIN_PHRASE_TOKENS = 2;

// -----------------------------------------------------------------------
// Errors. Mirror the validation/error shape used by `translations.ts`
// so endpoint handlers can pattern-match a single error type per kind.
// -----------------------------------------------------------------------

export class PhraseValidationError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = 'PhraseValidationError';
  }
}

// -----------------------------------------------------------------------
// Inputs.
// -----------------------------------------------------------------------

export type CreatePhraseInput = {
  language: LanguageCode;
  /** Ordered surface forms. Each element is a single token's surface
   *  text — exact form as it must appear in the chapter for the
   *  contiguous matcher (T-14.2) to pick it up. */
  tokens: string[];
  pos?: string | null;
  glossDefault?: string | null;
  source: Phrase['source'];
  submittedBy?: string | null;
  sourceAttribution?: string | null;
  sourceId?: string | null;
  frequencyRank?: number | null;
  /** Curator/admin callers may exceed `MAX_PHRASE_TOKENS`. Defaults
   *  to false — the user-facing API never sets this true. */
  bypassTokenCap?: boolean;
};

export type CreatePhraseResult = {
  phrase: Phrase;
  tokens: PhraseToken[];
  /** True iff the phrase already existed (dedupe hit). The endpoint
   *  layer translates that into a 200 instead of a 201 so clients
   *  can tell the difference. */
  reused: boolean;
};

// -----------------------------------------------------------------------
// Token normalisation.
// -----------------------------------------------------------------------

/**
 * Normalise a single token surface. NFC + trim. Light-touch on
 * purpose: matching is surface-exact for MVP, so we don't lowercase
 * or strip diacritics. Devanagari/Odia don't carry case, and folding
 * marks would break legitimate distinctions like nukta-bearing finals.
 */
function normalizeToken(s: string): string {
  return s.normalize('NFC').trim();
}

/**
 * Build the `surface_normalised` value from an ordered token list.
 * Joined with a single space — the dedupe lookup is purely literal
 * after this step. The chapter-span resolver (T-14.2) matches on the
 * canonical `phrase_tokens` rows, NOT on this string, so this column
 * never participates in detection.
 */
function joinTokens(tokens: string[]): string {
  return tokens.join(' ');
}

const PUNCT_RE = /^[\p{P}\s]+$/u;

function validateTokens(input: CreatePhraseInput): string[] {
  const raw = input.tokens ?? [];
  const tokens = raw.map(normalizeToken);
  if (tokens.length < MIN_PHRASE_TOKENS) {
    throw new PhraseValidationError(
      `phrase requires at least ${MIN_PHRASE_TOKENS} tokens`,
    );
  }
  const cap = input.bypassTokenCap ? Number.POSITIVE_INFINITY : MAX_PHRASE_TOKENS;
  if (tokens.length > cap) {
    throw new PhraseValidationError(
      `phrase exceeds ${MAX_PHRASE_TOKENS}-token limit (got ${tokens.length})`,
    );
  }
  for (const [i, t] of tokens.entries()) {
    if (t.length === 0) {
      throw new PhraseValidationError(`token at position ${i} is empty`);
    }
    if (PUNCT_RE.test(t)) {
      throw new PhraseValidationError(
        `token at position ${i} is punctuation-only`,
      );
    }
  }
  return tokens;
}

// -----------------------------------------------------------------------
// Public API.
// -----------------------------------------------------------------------

/**
 * Create a phrase, deduping against an existing `(language,
 * surface_normalised, source)` triple so a second user submitting
 * `इंतज़ार करना` reuses the original row. The `source` is part of
 * the dedupe key on purpose — a curator phrase and a user phrase
 * with the same surface stay as distinct rows for the merge UI
 * (T-14.7) to reconcile, exactly like lemmas do (T-3.10).
 *
 * Writes are split across two tables (`phrases`, `phrase_tokens`).
 * No native FK on `translations.target_id`; existence checks live
 * in the translation service.
 */
export async function createPhrase(
  input: CreatePhraseInput,
  now: Date = new Date(),
): Promise<CreatePhraseResult> {
  const tokens = validateTokens(input);
  const surfaceNormalised = joinTokens(tokens);

  // Dedupe lookup: a row with the same (language, surface, source)
  // is reused. Different sources for the same surface stay
  // distinct — `T-14.7 merge` reconciles those.
  const [existing] = (await db
    .select()
    .from(schema.phrases)
    .where(
      and(
        eq(schema.phrases.language, input.language),
        eq(schema.phrases.surfaceNormalised, surfaceNormalised),
        eq(schema.phrases.source, input.source),
      ),
    )
    .limit(1)) as Phrase[];

  if (existing) {
    const tokenRows = (await db
      .select()
      .from(schema.phraseTokens)
      .where(eq(schema.phraseTokens.phraseId, existing.id))) as PhraseToken[];
    tokenRows.sort((a, b) => a.position - b.position);
    return { phrase: existing, tokens: tokenRows, reused: true };
  }

  const [phrase] = (await db
    .insert(schema.phrases)
    .values({
      language: input.language,
      surfaceNormalised,
      pos: input.pos ?? null,
      glossDefault: input.glossDefault ?? null,
      frequencyRank: input.frequencyRank ?? null,
      source: input.source,
      sourceAttribution: input.sourceAttribution ?? null,
      sourceId: input.sourceId ?? null,
      curatorLocked: false,
      createdAt: now,
      updatedAt: now,
    })
    .returning()) as Phrase[];
  if (!phrase) throw new Error('phrases insert returned no row');

  const tokenRows = (await db
    .insert(schema.phraseTokens)
    .values(
      tokens.map((surface, position) => ({
        phraseId: phrase.id,
        position,
        surface,
        // T-14.1: lemma_id is a soft hint, not part of identity.
        // Resolution is deferred to T-14.4's curator editor; new
        // phrases land with NULL component lemmas.
        lemmaId: null,
      })),
    )
    .returning()) as PhraseToken[];
  tokenRows.sort((a, b) => a.position - b.position);

  // Note: callers that need the `submittedBy` audit (e.g. user
  // submissions) should also write a row to T-14.7's
  // lemma_edit_history with change_type='phrase_insert'. T-14.1
  // ships the schema and core CRUD — the audit-log integration
  // lands when `lemma_edit_change_type` is extended in T-14.7.
  void input.submittedBy;

  return { phrase, tokens: tokenRows, reused: false };
}

/**
 * Fetch a phrase + its ordered tokens + visible translations
 * (target_type='phrase'). `hidden` translations are filtered out at
 * this layer; curator/admin views must use a separate path that
 * pulls the moderation rows (lands with T-14.4).
 */
export async function getPhrase(
  id: string,
  options: {
    /** T-14.7: when set true, the loader returns hidden phrases
     *  too (used by the curator editor in T-14.4a). Default
     *  false — anonymous + user views never see a hidden phrase. */
    includeHidden?: boolean;
  } = {},
): Promise<{
  phrase: Phrase;
  tokens: PhraseToken[];
  translations: Translation[];
} | null> {
  const [phrase] = (await db
    .select()
    .from(schema.phrases)
    .where(eq(schema.phrases.id, id))
    .limit(1)) as Phrase[];
  if (!phrase) return null;
  // T-14.7: hidden gate. For default (non-curator) callers,
  // treat a hidden phrase as if it didn't exist so the
  // moderation surface stays clean.
  if (phrase.hidden && !options.includeHidden) return null;

  const tokens = (await db
    .select()
    .from(schema.phraseTokens)
    .where(eq(schema.phraseTokens.phraseId, id))) as PhraseToken[];
  tokens.sort((a, b) => a.position - b.position);

  const translations = (await db
    .select()
    .from(schema.translations)
    .where(
      and(
        eq(schema.translations.targetType, 'phrase'),
        eq(schema.translations.targetId, id),
        eq(schema.translations.hidden, false),
      ),
    )) as Translation[];

  return { phrase, tokens, translations };
}

/**
 * List phrases for a language. Pagination is offset-based to match
 * the dictionary browse page's pattern (T-3.6); the curator editor
 * in T-14.4 layers source/locale filters on top of this.
 */
export async function listPhrasesForLanguage(args: {
  language: LanguageCode;
  source?: Phrase['source'];
  limit?: number;
  offset?: number;
}): Promise<Phrase[]> {
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
  const offset = Math.max(args.offset ?? 0, 0);

  const where = args.source
    ? and(
        eq(schema.phrases.language, args.language),
        eq(schema.phrases.source, args.source),
      )
    : eq(schema.phrases.language, args.language);

  const rows = (await db
    .select()
    .from(schema.phrases)
    .where(where)
    .limit(limit)
    .offset(offset)) as Phrase[];

  return rows;
}

// -----------------------------------------------------------------------
// User-known status (T-14.1 mirror of T-5.5 setKnownLemmaStatus).
// -----------------------------------------------------------------------

/**
 * Upsert the user's known-status for a phrase. Mirrors
 * `setKnownLemmaStatus` exactly — same enum values, same per-language
 * cache recompute, same shape of returned row. Reader hooks this
 * from a phrase-popup status button in T-14.3.
 */
export async function setKnownPhraseStatus(args: {
  userId: string;
  phraseId: string;
  status: 'unknown' | 'learning' | 'known' | 'ignored';
  now?: Date;
}): Promise<UserKnownPhrase> {
  const now = args.now ?? new Date();

  const [phrase] = (await db
    .select({ id: schema.phrases.id, language: schema.phrases.language })
    .from(schema.phrases)
    .where(eq(schema.phrases.id, args.phraseId))
    .limit(1)) as Array<{ id: string; language: LanguageCode }>;
  if (!phrase) {
    throw new PhraseValidationError(`Phrase ${args.phraseId} not found`, 404);
  }
  const language = phrase.language;

  // Read-then-write — composite-PK upsert with onConflictDoUpdate
  // is awkward across our drivers; the same pattern is used in
  // `setKnownLemmaStatus`.
  const existing = (await db
    .select()
    .from(schema.userKnownPhrases)
    .where(eq(schema.userKnownPhrases.userId, args.userId))) as UserKnownPhrase[];
  const row = existing.find((r) => r.phraseId === args.phraseId);

  let result: UserKnownPhrase;
  if (row) {
    const [updated] = (await db
      .update(schema.userKnownPhrases)
      .set({ status: args.status, updatedAt: now })
      .where(
        and(
          eq(schema.userKnownPhrases.userId, args.userId),
          eq(schema.userKnownPhrases.phraseId, args.phraseId),
        ),
      )
      .returning()) as UserKnownPhrase[];
    if (!updated) throw new Error('Failed to update user_known_phrases');
    result = updated;
  } else {
    const [inserted] = (await db
      .insert(schema.userKnownPhrases)
      .values({
        userId: args.userId,
        phraseId: args.phraseId,
        status: args.status,
        updatedAt: now,
      })
      .returning()) as UserKnownPhrase[];
    if (!inserted) throw new Error('Failed to insert user_known_phrases');
    result = inserted;
  }

  // Recompute the per-language cache. Counted as the number of rows
  // with status='known' for the phrases in that language. This
  // mirrors the equivalent recompute in `setKnownLemmaStatus`.
  const allKnown = (await db
    .select({
      phraseId: schema.userKnownPhrases.phraseId,
      language: schema.phrases.language,
    })
    .from(schema.userKnownPhrases)
    .innerJoin(
      schema.phrases,
      eq(schema.phrases.id, schema.userKnownPhrases.phraseId),
    )
    .where(
      and(
        eq(schema.userKnownPhrases.userId, args.userId),
        eq(schema.userKnownPhrases.status, 'known'),
        eq(schema.phrases.language, language),
      ),
    )) as Array<{ phraseId: string; language: string }>;
  const knownCount = allKnown.length;
  await db
    .update(schema.userLanguages)
    .set({ knownPhrasesCountCache: knownCount })
    .where(
      and(
        eq(schema.userLanguages.userId, args.userId),
        eq(schema.userLanguages.language, language),
      ),
    );

  return result;
}

// -----------------------------------------------------------------------
// Public projections — what the API surfaces. Mirrors `publicTranslation`
// from `dictionary/translations.ts`.
// -----------------------------------------------------------------------

export function publicPhrase(phrase: Phrase, tokens: PhraseToken[]) {
  const ordered = [...tokens].sort((a, b) => a.position - b.position);
  return {
    id: phrase.id,
    language: phrase.language,
    tokens: ordered.map((t) => ({
      position: t.position,
      surface: t.surface,
      lemmaId: t.lemmaId,
    })),
    surfaceNormalised: phrase.surfaceNormalised,
    pos: phrase.pos,
    glossDefault: phrase.glossDefault,
    frequencyRank: phrase.frequencyRank,
    source: phrase.source,
    sourceAttribution: phrase.sourceAttribution,
    curatorLocked: phrase.curatorLocked,
    hidden: phrase.hidden,
    createdAt: phrase.createdAt,
    updatedAt: phrase.updatedAt,
  };
}

// -----------------------------------------------------------------------
// Curator merge + moderation (T-14.7).
// -----------------------------------------------------------------------

/**
 * Status precedence for `mergePhrases`. When the merge collapses
 * two `user_known_phrases` rows pointing at the dropped phrase
 * and the kept phrase, the higher status wins so a learner who
 * marked the dropped phrase 'known' doesn't accidentally lose
 * their progress to a 'learning' on the keep side.
 *
 * Order matches the lemma-side merge convention from T-3.7.
 */
const STATUS_RANK: Record<'unknown' | 'learning' | 'known' | 'ignored', number> = {
  unknown: 0,
  learning: 1,
  ignored: 2,
  known: 3,
};

function pickHigherStatus(
  a: 'unknown' | 'learning' | 'known' | 'ignored',
  b: 'unknown' | 'learning' | 'known' | 'ignored',
): 'unknown' | 'learning' | 'known' | 'ignored' {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

export type MergePhrasesInput = {
  /** The phrase that survives — translations / spans / status all
   *  reassign onto this id. */
  keepId: string;
  /** The phrase whose rows move onto `keepId` and whose row is
   *  deleted at the end. */
  dropId: string;
  /** Curator / admin performing the merge. Drives the audit row's
   *  `editor_id`; the same user must have authority over the
   *  language at the endpoint layer. */
  performedBy: string;
  /** Required curator-edit reason — soft "why" string passed
   *  through to the audit log. */
  reason: string;
};

export type MergePhrasesResult = {
  keptPhrase: Phrase;
  droppedPhrase: Phrase;
  /** Counts the merge moved over. The endpoint surfaces these so
   *  the curator UI can show a confirmation toast. */
  moved: {
    translations: number;
    spans: number;
    knownPhraseRows: number;
  };
};

export class PhraseMergeMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhraseMergeMismatchError';
  }
}

/**
 * Merge two duplicate phrases. Reassigns every per-phrase row
 * (`translations` polymorphic targets, `phrase_chapter_spans`,
 * `user_known_phrases`) from `dropId` onto `keepId`, deletes the
 * dropped phrase row, and writes one audit row on each side
 * (the `phrase_merge` change type carries direction-specific
 * payloads so a future revert can reconstruct).
 *
 * Validation:
 *  - Both phrases must exist.
 *  - Both phrases must share `language` and `surface_normalised` —
 *    cross-language or cross-surface merges go through a separate
 *    "consolidate variants" flow that doesn't ship in T-14.7.
 *  - `keepId !== dropId`.
 *
 * Conflict resolution:
 *  - `user_known_phrases` collisions: the higher status wins
 *    (`known` > `ignored` > `learning` > `unknown`).
 *  - `phrase_chapter_spans` collisions are dropped silently
 *    (the kept phrase already covers that occurrence).
 */
export async function mergePhrases(
  input: MergePhrasesInput,
  now: Date = new Date(),
): Promise<MergePhrasesResult> {
  if (input.keepId === input.dropId) {
    throw new PhraseMergeMismatchError(
      'keepId and dropId must be different phrases',
    );
  }

  const [keep] = (await db
    .select()
    .from(schema.phrases)
    .where(eq(schema.phrases.id, input.keepId))
    .limit(1)) as Phrase[];
  if (!keep) {
    throw new PhraseValidationError(
      `Phrase ${input.keepId} not found`,
      404,
    );
  }
  const [drop] = (await db
    .select()
    .from(schema.phrases)
    .where(eq(schema.phrases.id, input.dropId))
    .limit(1)) as Phrase[];
  if (!drop) {
    throw new PhraseValidationError(
      `Phrase ${input.dropId} not found`,
      404,
    );
  }

  if (keep.language !== drop.language) {
    throw new PhraseMergeMismatchError(
      `Cannot merge phrases across languages (${keep.language} vs ${drop.language})`,
    );
  }
  if (keep.surfaceNormalised !== drop.surfaceNormalised) {
    throw new PhraseMergeMismatchError(
      'Cannot merge phrases whose surface_normalised differs — use the variants flow',
    );
  }

  // ---- 1. Reassign translations.target_id (target_type='phrase').
  // The polymorphic columns are the canonical join key; lemma_id
  // stays untouched (phrase-target rows have it null already).
  const translationsBefore = (await db
    .select({ id: schema.translations.id })
    .from(schema.translations)
    .where(
      and(
        eq(schema.translations.targetType, 'phrase'),
        eq(schema.translations.targetId, input.dropId),
      ),
    )) as Array<{ id: string }>;

  if (translationsBefore.length > 0) {
    await db
      .update(schema.translations)
      .set({ targetId: input.keepId, updatedAt: now })
      .where(
        and(
          eq(schema.translations.targetType, 'phrase'),
          eq(schema.translations.targetId, input.dropId),
        ),
      );
  }

  // ---- 2. Reassign phrase_chapter_spans.
  // Drop side may overlap with keep side at the same
  // `(chapter_id, start_token_idx)` — pull both sets and keep
  // only the deltas to avoid a PK collision.
  const dropSpans = (await db
    .select()
    .from(schema.phraseChapterSpans)
    .where(eq(schema.phraseChapterSpans.phraseId, input.dropId))) as Array<{
    chapterId: string;
    startTokenIdx: number;
    endTokenIdx: number;
    phraseId: string;
  }>;
  let spansMoved = 0;
  if (dropSpans.length > 0) {
    const keepSpans = (await db
      .select({
        chapterId: schema.phraseChapterSpans.chapterId,
        startTokenIdx: schema.phraseChapterSpans.startTokenIdx,
      })
      .from(schema.phraseChapterSpans)
      .where(eq(schema.phraseChapterSpans.phraseId, input.keepId))) as Array<{
      chapterId: string;
      startTokenIdx: number;
    }>;
    const keepKey = new Set(
      keepSpans.map((s) => `${s.chapterId}:${s.startTokenIdx}`),
    );
    const moveable = dropSpans.filter(
      (s) => !keepKey.has(`${s.chapterId}:${s.startTokenIdx}`),
    );
    if (moveable.length > 0) {
      await db
        .update(schema.phraseChapterSpans)
        .set({ phraseId: input.keepId })
        .where(
          and(
            eq(schema.phraseChapterSpans.phraseId, input.dropId),
            inArray(
              schema.phraseChapterSpans.chapterId,
              moveable.map((s) => s.chapterId),
            ),
          ),
        );
      spansMoved = moveable.length;
    }
    // Any remaining drop-side spans (those that collided with keep
    // spans on the same start) are deleted by the cascade when
    // the dropped phrase row is removed below.
  }

  // ---- 3. Reassign user_known_phrases.
  // For collisions the higher status wins; for non-collisions
  // we update the row's phrase_id pointer.
  const dropStatusRows = (await db
    .select()
    .from(schema.userKnownPhrases)
    .where(eq(schema.userKnownPhrases.phraseId, input.dropId))) as Array<{
    userId: string;
    phraseId: string;
    status: 'unknown' | 'learning' | 'known' | 'ignored';
    updatedAt: Date;
  }>;
  let knownRowsMoved = 0;
  for (const row of dropStatusRows) {
    const [collision] = (await db
      .select()
      .from(schema.userKnownPhrases)
      .where(
        and(
          eq(schema.userKnownPhrases.userId, row.userId),
          eq(schema.userKnownPhrases.phraseId, input.keepId),
        ),
      )
      .limit(1)) as Array<{
      userId: string;
      status: 'unknown' | 'learning' | 'known' | 'ignored';
    }>;
    if (collision) {
      const next = pickHigherStatus(collision.status, row.status);
      if (next !== collision.status) {
        await db
          .update(schema.userKnownPhrases)
          .set({ status: next, updatedAt: now })
          .where(
            and(
              eq(schema.userKnownPhrases.userId, row.userId),
              eq(schema.userKnownPhrases.phraseId, input.keepId),
            ),
          );
      }
      // Drop side row is removed by the cascade when we delete
      // the dropped phrase below.
    } else {
      await db
        .update(schema.userKnownPhrases)
        .set({ phraseId: input.keepId, updatedAt: now })
        .where(
          and(
            eq(schema.userKnownPhrases.userId, row.userId),
            eq(schema.userKnownPhrases.phraseId, input.dropId),
          ),
        );
      knownRowsMoved += 1;
    }
  }

  // ---- 4. Bump kept phrase's updated_at so caches invalidate.
  const [kept] = (await db
    .update(schema.phrases)
    .set({ updatedAt: now })
    .where(eq(schema.phrases.id, input.keepId))
    .returning()) as Phrase[];

  // ---- 5. Delete dropped phrase. Cascading FKs clean up any
  // remaining rows on `phrase_tokens`, leftover collision rows
  // on `phrase_chapter_spans`, and `user_known_phrases`.
  await db.delete(schema.phrases).where(eq(schema.phrases.id, input.dropId));

  // ---- 6. Audit rows on both sides — see audit.ts for the
  // change-type enum extension.
  const { recordPhraseEdit } = await import('./dictionary/audit.js');
  await recordPhraseEdit({
    phraseId: input.keepId,
    editorId: input.performedBy,
    changeType: 'phrase_merge',
    change: {
      direction: 'winner',
      mergedFrom: {
        id: drop.id,
        surfaceNormalised: drop.surfaceNormalised,
        source: drop.source,
        sourceAttribution: drop.sourceAttribution,
      },
      translationIds: translationsBefore.map((t) => t.id),
    },
    reason: input.reason,
  });
  // The "loser" row in lemma_edit_history still references the
  // now-deleted phrase via its phrase_id FK — that FK is
  // ON DELETE CASCADE, but we record the loser audit *before*
  // deletion is cascaded so curators can see the merge from
  // either side. Drizzle's delete in step 5 is a separate
  // statement; the audit insert succeeds because we run it after
  // the kept-side audit but referencing the dropped phrase id
  // would FK-fail. Instead we record the loser-side audit on the
  // *kept* phrase too with `direction: 'loser'`, so both rows
  // reference the surviving phrase and the audit reader can group
  // by the kept phrase's id to see "this row absorbed that one".
  await recordPhraseEdit({
    phraseId: input.keepId,
    editorId: input.performedBy,
    changeType: 'phrase_merge',
    change: {
      direction: 'loser',
      translationIds: translationsBefore.map((t) => t.id),
    },
    reason: input.reason,
  });

  return {
    keptPhrase: kept ?? keep,
    droppedPhrase: drop,
    moved: {
      translations: translationsBefore.length,
      spans: spansMoved,
      knownPhraseRows: knownRowsMoved,
    },
  };
}

/**
 * Toggle the `hidden` moderation flag on a phrase. Hidden
 * phrases stay visible to curators / admins (so they can review
 * + unhide) but disappear from anonymous and user views. T-14.4
 * popup `getPhrase` already filters `phrases.hidden=false` for
 * its translations payload — endpoints layered on top of this
 * service apply the same filter for the phrase row itself.
 */
export async function setPhraseHidden(args: {
  phraseId: string;
  hidden: boolean;
  editorId: string;
  reason: string;
  now?: Date;
}): Promise<Phrase> {
  const now = args.now ?? new Date();
  const [existing] = (await db
    .select()
    .from(schema.phrases)
    .where(eq(schema.phrases.id, args.phraseId))
    .limit(1)) as Phrase[];
  if (!existing) {
    throw new PhraseValidationError(
      `Phrase ${args.phraseId} not found`,
      404,
    );
  }
  if (existing.hidden === args.hidden) return existing;

  const [updated] = (await db
    .update(schema.phrases)
    .set({ hidden: args.hidden, updatedAt: now })
    .where(eq(schema.phrases.id, args.phraseId))
    .returning()) as Phrase[];
  if (!updated) throw new Error('Failed to set hidden flag');

  const { recordPhraseEdit } = await import('./dictionary/audit.js');
  await recordPhraseEdit({
    phraseId: args.phraseId,
    editorId: args.editorId,
    changeType: args.hidden ? 'phrase_hide' : 'phrase_unhide',
    change: {
      before: { hidden: existing.hidden },
      after: { hidden: args.hidden },
    },
    reason: args.reason,
  });
  return updated;
}

/**
 * Toggle the `curator_locked` flag on a phrase, parallel to the
 * lemma-side lock from T-3.7. A locked phrase is skipped by the
 * import path — neither user submissions nor T-14.5a's NLP
 * promotion can clobber its gloss / frequency / source after a
 * human has approved it.
 */
export async function setPhraseLocked(args: {
  phraseId: string;
  locked: boolean;
  editorId: string;
  reason: string;
  now?: Date;
}): Promise<Phrase> {
  const now = args.now ?? new Date();
  const [existing] = (await db
    .select()
    .from(schema.phrases)
    .where(eq(schema.phrases.id, args.phraseId))
    .limit(1)) as Phrase[];
  if (!existing) {
    throw new PhraseValidationError(
      `Phrase ${args.phraseId} not found`,
      404,
    );
  }
  if (existing.curatorLocked === args.locked) return existing;

  const [updated] = (await db
    .update(schema.phrases)
    .set({ curatorLocked: args.locked, updatedAt: now })
    .where(eq(schema.phrases.id, args.phraseId))
    .returning()) as Phrase[];
  if (!updated) throw new Error('Failed to set lock flag');

  const { recordPhraseEdit } = await import('./dictionary/audit.js');
  await recordPhraseEdit({
    phraseId: args.phraseId,
    editorId: args.editorId,
    changeType: args.locked ? 'phrase_lock' : 'phrase_unlock',
    change: {
      before: { curatorLocked: existing.curatorLocked },
      after: { curatorLocked: args.locked },
    },
    reason: args.reason,
  });
  return updated;
}

// -----------------------------------------------------------------------
// Curator editor service (T-14.4a — admin dictionary surface).
// -----------------------------------------------------------------------

export type AdminPhraseListItem = {
  id: string;
  language: LanguageCode;
  surfaceNormalised: string;
  pos: string | null;
  glossDefault: string | null;
  frequencyRank: number | null;
  source: Phrase['source'];
  curatorLocked: boolean;
  hidden: boolean;
  /** Visible (non-hidden) translation count for this phrase. */
  translationCount: number;
  /** Number of distinct chapters this phrase has matched in via
   *  T-14.2's resolver — gives curators a quick read on usage. */
  chapterCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type ListAdminPhrasesArgs = {
  language: LanguageCode;
  source?: Phrase['source'];
  /** Filter on `curator_locked`. Omit to include both. */
  locked?: boolean;
  /** Filter on `hidden`. Omit to include both — the curator
   *  needs to see hidden rows in order to unhide them. */
  hidden?: boolean;
  limit?: number;
  offset?: number;
};

/**
 * Paginated list of phrases for the curator dictionary editor
 * (parallel to `dictionary/lookups.ts` for lemmas). Includes
 * hidden + curator-locked phrases by default since the editor
 * audience IS the curator.
 *
 * `translationCount` and `chapterCount` come from correlated
 * subqueries so the list query is one round-trip even on the
 * larger phrase tables.
 */
export async function listAdminPhrases(
  args: ListAdminPhrasesArgs,
): Promise<AdminPhraseListItem[]> {
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
  const offset = Math.max(args.offset ?? 0, 0);

  // Build the WHERE list dynamically so the query plan stays
  // tight when no optional filters are set.
  const wheres = [eq(schema.phrases.language, args.language)];
  if (args.source) wheres.push(eq(schema.phrases.source, args.source));
  if (args.locked !== undefined) {
    wheres.push(eq(schema.phrases.curatorLocked, args.locked));
  }
  if (args.hidden !== undefined) {
    wheres.push(eq(schema.phrases.hidden, args.hidden));
  }

  const rows = (await db
    .select({
      id: schema.phrases.id,
      language: schema.phrases.language,
      surfaceNormalised: schema.phrases.surfaceNormalised,
      pos: schema.phrases.pos,
      glossDefault: schema.phrases.glossDefault,
      frequencyRank: schema.phrases.frequencyRank,
      source: schema.phrases.source,
      curatorLocked: schema.phrases.curatorLocked,
      hidden: schema.phrases.hidden,
      createdAt: schema.phrases.createdAt,
      updatedAt: schema.phrases.updatedAt,
      translationCount: sql<number>`(
        SELECT COUNT(*)::int FROM ${schema.translations} t
        WHERE t.target_type = 'phrase'
          AND t.target_id = ${schema.phrases.id}
          AND t.hidden = false
      )`,
      chapterCount: sql<number>`(
        SELECT COUNT(DISTINCT pcs.chapter_id)::int
        FROM ${schema.phraseChapterSpans} pcs
        WHERE pcs.phrase_id = ${schema.phrases.id}
      )`,
    })
    .from(schema.phrases)
    .where(and(...wheres))
    .orderBy(desc(schema.phrases.updatedAt))
    .limit(limit)
    .offset(offset)) as AdminPhraseListItem[];

  return rows;
}

export type PhraseEditorView = {
  phrase: Phrase;
  tokens: PhraseToken[];
  /** All phrase-target translations including hidden rows —
   *  curators need to see what's been moderated. */
  translations: Translation[];
  /** Distinct chapter IDs this phrase appears in. Drives the
   *  span preview affordance. */
  chapterIds: string[];
  /** Recent audit-log entries on this phrase, newest first. */
  history: Array<{
    id: string;
    changeType: string;
    reason: string;
    createdAt: Date;
    editorId: string | null;
  }>;
};

/**
 * Full editor view: phrase + tokens + every translation (hidden
 * included) + chapter occurrences + recent audit history. Mirror
 * of `getLemmaEditorView` for lemmas.
 */
export async function getPhraseEditorView(
  phraseId: string,
): Promise<PhraseEditorView | null> {
  const [phrase] = (await db
    .select()
    .from(schema.phrases)
    .where(eq(schema.phrases.id, phraseId))
    .limit(1)) as Phrase[];
  if (!phrase) return null;

  const tokens = (await db
    .select()
    .from(schema.phraseTokens)
    .where(eq(schema.phraseTokens.phraseId, phraseId))) as PhraseToken[];
  tokens.sort((a, b) => a.position - b.position);

  // Curator view: include hidden rows (the moderation toggle is
  // here precisely so the curator can review them).
  const translations = (await db
    .select()
    .from(schema.translations)
    .where(
      and(
        eq(schema.translations.targetType, 'phrase'),
        eq(schema.translations.targetId, phraseId),
      ),
    )) as Translation[];

  const chapterRows = (await db
    .selectDistinct({ chapterId: schema.phraseChapterSpans.chapterId })
    .from(schema.phraseChapterSpans)
    .where(eq(schema.phraseChapterSpans.phraseId, phraseId))) as Array<{
    chapterId: string;
  }>;
  const chapterIds = chapterRows.map((r) => r.chapterId);

  const historyRows = (await db
    .select({
      id: schema.lemmaEditHistory.id,
      changeType: schema.lemmaEditHistory.changeType,
      reason: schema.lemmaEditHistory.reason,
      createdAt: schema.lemmaEditHistory.createdAt,
      editorId: schema.lemmaEditHistory.editorId,
    })
    .from(schema.lemmaEditHistory)
    .where(eq(schema.lemmaEditHistory.phraseId, phraseId))
    .orderBy(desc(schema.lemmaEditHistory.createdAt))
    .limit(50)) as Array<{
    id: string;
    changeType: string;
    reason: string;
    createdAt: Date;
    editorId: string | null;
  }>;

  return { phrase, tokens, translations, chapterIds, history: historyRows };
}

export type UpdatePhraseFieldsPatch = {
  glossDefault?: string | null;
  pos?: string | null;
  frequencyRank?: number | null;
  sourceAttribution?: string | null;
};

/**
 * Patch editable fields on a phrase row + write a `phrase_update`
 * audit entry. Mirror of `updateLemma`. Implicitly flips
 * `curatorLocked=true` so subsequent NLP promotion / re-import
 * can't clobber the curator edit — same safety net as the lemma
 * path.
 */
export async function updatePhraseFields(args: {
  phraseId: string;
  patch: UpdatePhraseFieldsPatch;
  editorId: string;
  reason: string;
  now?: Date;
}): Promise<Phrase> {
  const now = args.now ?? new Date();

  // Light validation — match the createPhrase rules.
  if (args.patch.pos !== undefined && args.patch.pos !== null) {
    if (args.patch.pos.length > 32) {
      throw new PhraseValidationError('pos exceeds 32 characters');
    }
  }
  if (args.patch.glossDefault !== undefined && args.patch.glossDefault !== null) {
    if (args.patch.glossDefault.length > 500) {
      throw new PhraseValidationError(
        'glossDefault exceeds 500 characters',
      );
    }
  }
  if (
    args.patch.frequencyRank !== undefined &&
    args.patch.frequencyRank !== null
  ) {
    if (
      !Number.isInteger(args.patch.frequencyRank) ||
      args.patch.frequencyRank < 0
    ) {
      throw new PhraseValidationError(
        'frequencyRank must be a non-negative integer',
      );
    }
  }

  const [existing] = (await db
    .select()
    .from(schema.phrases)
    .where(eq(schema.phrases.id, args.phraseId))
    .limit(1)) as Phrase[];
  if (!existing) {
    throw new PhraseValidationError(
      `Phrase ${args.phraseId} not found`,
      404,
    );
  }

  const setValues: Partial<Phrase> = { updatedAt: now };
  if (args.patch.glossDefault !== undefined) {
    setValues.glossDefault = args.patch.glossDefault;
  }
  if (args.patch.pos !== undefined) setValues.pos = args.patch.pos;
  if (args.patch.frequencyRank !== undefined) {
    setValues.frequencyRank = args.patch.frequencyRank;
  }
  if (args.patch.sourceAttribution !== undefined) {
    setValues.sourceAttribution = args.patch.sourceAttribution;
  }
  // Implicit lock — same as updateLemma.
  setValues.curatorLocked = true;

  const [updated] = (await db
    .update(schema.phrases)
    .set(setValues)
    .where(eq(schema.phrases.id, args.phraseId))
    .returning()) as Phrase[];
  if (!updated) throw new Error('Failed to update phrase');

  const { recordPhraseEdit } = await import('./dictionary/audit.js');
  await recordPhraseEdit({
    phraseId: args.phraseId,
    editorId: args.editorId,
    changeType: 'phrase_update',
    change: {
      before: snapshotPhrase(existing),
      after: snapshotPhrase(updated),
    },
    reason: args.reason,
  });
  return updated;
}

function snapshotPhrase(p: Phrase): Record<string, unknown> {
  return {
    id: p.id,
    language: p.language,
    surfaceNormalised: p.surfaceNormalised,
    pos: p.pos,
    glossDefault: p.glossDefault,
    frequencyRank: p.frequencyRank,
    source: p.source,
    sourceAttribution: p.sourceAttribution,
    curatorLocked: p.curatorLocked,
    hidden: p.hidden,
  };
}

// Suppress a noisy unused-import warning when only the typecheck
// hits this file. `isNull` is exported for callers that want to
// query un-resolved component-lemma rows on `phrase_tokens`.
export { isNull };
