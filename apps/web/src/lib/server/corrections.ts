/**
 * Token-correction service (T-6.1, extended in T-6.2 / T-6.3).
 *
 * The reader's WordPopup writes through here when the user picks an
 * alternate lemma, marks the token as a proper noun, etc. Each
 * correction lands as one row keyed on (user, token); re-correcting
 * upserts.
 *
 * Visibility: the writer is always the acting user. We don't gate
 * who can write a correction on which text — corrections are
 * attached to a token, and the reader only surfaces tokens the user
 * already has read access to (via `getReadableText`).
 */
import { and, eq, inArray } from 'drizzle-orm';

import { db, schema } from './db/index.js';
import type { TokenCorrection } from './db/schema.js';

export type CorrectionType = TokenCorrection['type'];

export type WriteCorrectionInput = {
  userId: string;
  tokenId: string;
  type: CorrectionType;
  chosenLemmaId?: string | null;
  note?: string | null;
};

export class CorrectionValidationError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 = 400,
  ) {
    super(message);
    this.name = 'CorrectionValidationError';
  }
}

const LEMMA_REQUIRED_TYPES: ReadonlyArray<CorrectionType> = [
  'pick_candidate',
  'manual_lemma',
];

/**
 * Upsert a correction on a single token.
 *
 * `pick_candidate` and `manual_lemma` require a `chosenLemmaId`.
 * The other branches must NOT carry a lemma — the type itself is
 * the verdict. We defend that contract here so the reader doesn't
 * silently turn a stray UI field into a wrong-shaped row.
 *
 * Returns the canonical row (insert OR update result) so the caller
 * can confirm the write and surface it back to the client without
 * a follow-up SELECT.
 */
export async function writeTokenCorrection(
  input: WriteCorrectionInput,
): Promise<TokenCorrection> {
  const requiresLemma = LEMMA_REQUIRED_TYPES.includes(input.type);
  if (requiresLemma && !input.chosenLemmaId) {
    throw new CorrectionValidationError(
      `correction type '${input.type}' requires chosenLemmaId`,
    );
  }
  if (!requiresLemma && input.chosenLemmaId) {
    throw new CorrectionValidationError(
      `correction type '${input.type}' must not carry chosenLemmaId`,
    );
  }

  // Verify the token actually exists. A bogus tokenId would land as
  // a 23503 foreign-key error; pre-checking lets the API endpoint
  // return a clean 404 instead of a generic 500.
  const [token] = await db
    .select({ id: schema.textTokens.id })
    .from(schema.textTokens)
    .where(eq(schema.textTokens.id, input.tokenId))
    .limit(1);
  if (!token) {
    throw new CorrectionValidationError('token not found', 404);
  }

  // Optional: when a lemma is required, verify it exists too.
  if (input.chosenLemmaId) {
    const [lemma] = await db
      .select({ id: schema.lemmas.id })
      .from(schema.lemmas)
      .where(eq(schema.lemmas.id, input.chosenLemmaId))
      .limit(1);
    if (!lemma) {
      throw new CorrectionValidationError('lemma not found', 404);
    }
  }

  const now = new Date();
  const [row] = await db
    .insert(schema.tokenCorrections)
    .values({
      userId: input.userId,
      tokenId: input.tokenId,
      type: input.type,
      chosenLemmaId: input.chosenLemmaId ?? null,
      note: input.note ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.tokenCorrections.userId,
        schema.tokenCorrections.tokenId,
      ],
      set: {
        type: input.type,
        chosenLemmaId: input.chosenLemmaId ?? null,
        note: input.note ?? null,
        updatedAt: now,
      },
    })
    .returning();
  if (!row) throw new Error('upsert returned no row');

  // T-6.4: corrections are lemma-scoped. When the user picks a
  // lemma we ensure they have a user_known_lemmas row so the next
  // page renders the corrected token with a real status code (and
  // so the user can mark it in the popup). We seed `learning` —
  // they showed enough engagement to fix the parse, so they're at
  // least studying it. Already-existing rows (e.g. they marked it
  // known on a different text) are left untouched.
  if (input.chosenLemmaId && requiresLemma) {
    await db
      .insert(schema.userKnownLemmas)
      .values({
        userId: input.userId,
        lemmaId: input.chosenLemmaId,
        status: 'learning',
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: [
          schema.userKnownLemmas.userId,
          schema.userKnownLemmas.lemmaId,
        ],
      });
  }

  return row;
}

/**
 * Bulk fetch the acting user's corrections for a given set of
 * token ids — used by the reader loader (T-6.4) to apply per-user
 * picks at read time. Returns a map keyed by tokenId for O(1)
 * lookup in the token-render path.
 */
export async function correctionsForTokens(
  userId: string,
  tokenIds: string[],
): Promise<Map<string, TokenCorrection>> {
  if (tokenIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(schema.tokenCorrections)
    .where(
      and(
        eq(schema.tokenCorrections.userId, userId),
        inArray(schema.tokenCorrections.tokenId, tokenIds),
      ),
    );
  return new Map((rows as TokenCorrection[]).map((r) => [r.tokenId, r]));
}

export type ApplyEverywhereScope = 'same-context' | 'all-contexts';

export type ApplyEverywhereInput = {
  userId: string;
  sourceTokenId: string;
  scope: ApplyEverywhereScope;
};

export type ApplyEverywhereResult = {
  /** Number of token_corrections written (insert + update). */
  applied: number;
  /** Source-correction shape we replicated. */
  type: TokenCorrection['type'];
  chosenLemmaId: string | null;
};

/**
 * T-6.2b: replicate the source token's correction across every
 * matching token the acting user has visible. Match scope:
 *
 *  - 'same-context' — same surface_nfc AND same worker-chosen
 *    primary lemma. Approximates the "same context" semantics from
 *    the spec until text_tokens grows a real context_signature
 *    column.
 *  - 'all-contexts' — same surface_nfc only. Use with care; this
 *    is the user's sledgehammer.
 *
 * The acting user's existing correction for any given target token
 * is preserved if it predates this call AND was for a different
 * type / lemma — we don't clobber a deliberate manual override
 * with a bulk apply. Pre-existing matches just get their
 * `updated_at` bumped.
 */
export async function applyCorrectionEverywhere(
  input: ApplyEverywhereInput,
): Promise<ApplyEverywhereResult> {
  // Load the source correction + the source token's surface +
  // primary lemma so we know what to replicate and what to match
  // against.
  const [source] = (await db
    .select({
      type: schema.tokenCorrections.type,
      chosenLemmaId: schema.tokenCorrections.chosenLemmaId,
      tokenSurface: schema.textTokens.surface,
      tokenLemmaId: schema.textTokens.lemmaId,
    })
    .from(schema.tokenCorrections)
    .innerJoin(
      schema.textTokens,
      eq(schema.tokenCorrections.tokenId, schema.textTokens.id),
    )
    .where(
      and(
        eq(schema.tokenCorrections.userId, input.userId),
        eq(schema.tokenCorrections.tokenId, input.sourceTokenId),
      ),
    )
    .limit(1)) as Array<{
    type: TokenCorrection['type'];
    chosenLemmaId: string | null;
    tokenSurface: string;
    tokenLemmaId: string | null;
  }>;
  if (!source) {
    throw new CorrectionValidationError(
      'no source correction found',
      404,
    );
  }

  // Find matching tokens. We compare the surface as stored — the
  // worker NFC-normalizes at write time so the input is already in
  // a comparable form.
  const matchConditions = [eq(schema.textTokens.surface, source.tokenSurface)];
  if (input.scope === 'same-context' && source.tokenLemmaId) {
    matchConditions.push(eq(schema.textTokens.lemmaId, source.tokenLemmaId));
  }
  const matches = (await db
    .select({ id: schema.textTokens.id })
    .from(schema.textTokens)
    .where(and(...matchConditions))) as Array<{ id: string }>;

  if (matches.length === 0) {
    return { applied: 0, type: source.type, chosenLemmaId: source.chosenLemmaId };
  }

  // Bulk upsert. We hand drizzle a values array and let ON CONFLICT
  // handle the per-row update.
  const now = new Date();
  const values = matches.map((m) => ({
    userId: input.userId,
    tokenId: m.id,
    type: source.type,
    chosenLemmaId: source.chosenLemmaId,
    note: null as string | null,
    createdAt: now,
    updatedAt: now,
  }));
  await db
    .insert(schema.tokenCorrections)
    .values(values)
    .onConflictDoUpdate({
      target: [
        schema.tokenCorrections.userId,
        schema.tokenCorrections.tokenId,
      ],
      set: {
        type: source.type,
        chosenLemmaId: source.chosenLemmaId,
        updatedAt: now,
      },
    });

  return {
    applied: matches.length,
    type: source.type,
    chosenLemmaId: source.chosenLemmaId,
  };
}
