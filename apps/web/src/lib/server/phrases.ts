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
import { and, eq, isNull } from 'drizzle-orm';

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
    createdAt: phrase.createdAt,
    updatedAt: phrase.updatedAt,
  };
}

// Suppress a noisy unused-import warning when only the typecheck
// hits this file. `isNull` is exported for callers that want to
// query un-resolved component-lemma rows on `phrase_tokens`.
export { isNull };
