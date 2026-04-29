/**
 * lemma_proposals service (T-6.3).
 *
 * Submits a new-lemma proposal from the correction modal. Writes
 * three rows in one transaction-shaped call:
 *
 *   1. lemma_proposals (status='pending') — the canonical record.
 *   2. token_corrections (type='new_lemma') — the per-user marker
 *      that drives the reader's render for this token.
 *   3. parse_reports — auto-filed so the curator dashboard
 *      surfaces it. Dedup-merging applies here too: a second user
 *      proposing the same headword + surface increments the
 *      existing report's duplicate_count.
 *
 * Curator acceptance in T-6.6 copies the proposal into `lemmas`
 * and back-fills `token_corrections.chosen_lemma_id`.
 */
import { eq } from 'drizzle-orm';

import { db, schema } from './db/index.js';
import type {
  LemmaProposal,
  TokenCorrection,
} from './db/schema.js';
import { fileParseReport } from './parse-reports.js';
import type { LanguageCode } from '@ciareader/shared-types';

export type SubmitLemmaProposalInput = {
  proposerId: string;
  tokenId: string;
  language: LanguageCode;
  headword: string;
  pos: string;
  glossDefault?: string | null;
  notes?: string | null;
  /** The token's surface form at proposal time (snapshot for the
   *  parse_report). */
  surfaceNfc: string;
  contextSignature?: string;
  originalCandidates: Array<{
    lemmaId: string | null;
    score: number;
    features: Record<string, string>;
  }>;
};

export class LemmaProposalValidationError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 = 400,
  ) {
    super(message);
    this.name = 'LemmaProposalValidationError';
  }
}

export type SubmitLemmaProposalResult = {
  proposal: LemmaProposal;
  correction: TokenCorrection;
};

/**
 * The headword normalisation is deliberately light: NFC + trim.
 * Curators handle deeper canonicalisation (compound headwords,
 * variant spelling) at acceptance time.
 */
function normalize(s: string): string {
  return s.normalize('NFC').trim();
}

export async function submitLemmaProposal(
  input: SubmitLemmaProposalInput,
): Promise<SubmitLemmaProposalResult> {
  const headword = normalize(input.headword);
  const pos = normalize(input.pos);
  if (!headword) {
    throw new LemmaProposalValidationError('headword required');
  }
  if (!pos) {
    throw new LemmaProposalValidationError('pos required');
  }

  // Verify the token exists so the foreign key on token_corrections
  // doesn't blow up under our feet.
  const [token] = await db
    .select({ id: schema.textTokens.id })
    .from(schema.textTokens)
    .where(eq(schema.textTokens.id, input.tokenId))
    .limit(1);
  if (!token) {
    throw new LemmaProposalValidationError('token not found', 404);
  }

  const now = new Date();
  const [proposal] = await db
    .insert(schema.lemmaProposals)
    .values({
      proposerId: input.proposerId,
      language: input.language,
      headword,
      pos,
      glossDefault: input.glossDefault ? normalize(input.glossDefault) : null,
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!proposal) throw new Error('lemma_proposals insert returned no row');

  // Per-user correction marker so the reader stops colouring this
  // token until the proposal is reviewed.
  const [correction] = await db
    .insert(schema.tokenCorrections)
    .values({
      userId: input.proposerId,
      tokenId: input.tokenId,
      type: 'new_lemma',
      chosenLemmaId: null,
      // Store the proposal id in `note` for the audit trail until
      // the curator accepts and back-fills chosenLemmaId. We use
      // the column for this rather than a dedicated FK so the
      // happy-path schema stays minimal.
      note: `proposal:${(proposal as LemmaProposal).id}`,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.tokenCorrections.userId,
        schema.tokenCorrections.tokenId,
      ],
      set: {
        type: 'new_lemma',
        chosenLemmaId: null,
        note: `proposal:${(proposal as LemmaProposal).id}`,
        updatedAt: now,
      },
    })
    .returning();
  if (!correction) throw new Error('token_corrections upsert returned no row');

  // Auto-file a parse_report so the curator surface picks it up.
  // Dedup-merge handles repeated proposals for the same surface.
  await fileParseReport({
    reporterId: input.proposerId,
    tokenId: input.tokenId,
    language: input.language,
    surfaceNfc: input.surfaceNfc,
    contextSignature: input.contextSignature,
    originalCandidates: input.originalCandidates,
    correctedLemmaId: null,
    correctionType: 'new_lemma',
    note: `proposal:${(proposal as LemmaProposal).id} ${headword}/${pos}`,
  });

  return { proposal: proposal as LemmaProposal, correction: correction as TokenCorrection };
}
