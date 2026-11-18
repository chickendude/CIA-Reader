import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { canReadText } from '../auth/can-read.js';
import { isCuratorOrAdmin } from '../dictionary/permissions.js';
import type { User } from '../db/schema.js';

export type HindiContextChoice = {
  selectedLemmaIds: string[];
  selectedOrigins: Record<string, 'ai' | 'human'>;
  origin: 'ai' | 'human';
  status: string;
};

export function contextVersion(candidates: string[], choice?: HindiContextChoice): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        candidates: [...candidates].sort(),
        selected: [...(choice?.selectedLemmaIds ?? [])].sort(),
        origins: Object.entries(choice?.selectedOrigins ?? {}).sort(),
        status: choice?.status ?? 'unconfirmed',
      }),
    )
    .digest('hex');
}

export async function canVerifyHindiContext(
  chapterId: string,
  userId: string | null,
): Promise<boolean> {
  if (!userId) return false;
  const [row] = await db.execute(sql`SELECT t.owner_id,t.visibility,u.role FROM text_chapters c
    JOIN texts t ON t.id=c.text_id JOIN users u ON u.id=${userId} WHERE c.id=${chapterId} AND t.language='hi'`);
  return Boolean(
    row &&
    (row.visibility === 'official'
      ? ['admin', 'curator'].includes(String(row.role))
      : row.owner_id === userId),
  );
}

export class ContextChoiceError extends Error {
  constructor(
    message: string,
    public status: 400 | 403 | 404 | 409,
  ) {
    super(message);
  }
}

export async function saveHindiContextChoice(
  tokenId: string,
  selected: string[],
  expectedVersion: string,
  actor: Pick<User, 'id' | 'role'>,
  ai?: { model: string; reason: string; outcome: 'selected' | 'uncertain' | 'none_fit' },
) {
  return db.transaction(async (tx) => {
    const [token] = await tx
      .select()
      .from(schema.textTokens)
      .where(eq(schema.textTokens.id, tokenId))
      .limit(1)
      .for('update');
    if (!token) throw new ContextChoiceError('Word not found', 404);
    const [row] = await tx
      .select({ chapter: schema.textChapters, text: schema.texts })
      .from(schema.textChapters)
      .innerJoin(schema.texts, eq(schema.texts.id, schema.textChapters.textId))
      .where(eq(schema.textChapters.id, token.chapterId))
      .limit(1);
    if (!row || row.text.language !== 'hi' || !(await canReadText(actor, row.text)))
      throw new ContextChoiceError('Word not found', 404);
    if (
      row.text.visibility === 'official' ? !isCuratorOrAdmin(actor) : row.text.ownerId !== actor.id
    )
      throw new ContextChoiceError(
        'Only the owner or Official library staff can verify this occurrence',
        403,
      );
    if (ai && !isCuratorOrAdmin(actor)) throw new ContextChoiceError('Staff access required', 403);
    const [analysis] =
      await tx.execute(sql`SELECT a.revision=d.revision AS current FROM hindi_chapter_analyses a
      JOIN hindi_dictionary_state d ON d.id=1 WHERE a.chapter_id=${token.chapterId}`);
    if (!analysis?.current)
      throw new ContextChoiceError('Reprocess this chapter before verifying its entries', 409);
    const [offset] = await tx.execute(sql`SELECT COALESCE(sum(char_length(surface)),0)::int AS start
      FROM text_tokens WHERE chapter_id=${token.chapterId} AND idx<${token.idx}`);
    const start = Number(offset?.start ?? 0);
    const choices = await loadHindiContextChoices(token.chapterId);
    const candidateIds = token.lemmaCandidates.flatMap((c) => (c.lemmaId ? [c.lemmaId] : []));
    if (contextVersion(candidateIds, choices.get(start)) !== expectedVersion)
      throw new ContextChoiceError('This selection changed. Reopen the word before saving.', 409);
    const existing = await tx
      .select()
      .from(schema.hindiContextChoices)
      .where(
        and(
          eq(schema.hindiContextChoices.chapterId, token.chapterId),
          eq(schema.hindiContextChoices.sourceStart, start),
        ),
      );
    if (ai && existing.some((c) => c.origin === 'human' && c.status === 'confirmed'))
      throw new ContextChoiceError('A human has already confirmed this occurrence', 409);
    const occurrences = await tx
      .select()
      .from(schema.hindiOccurrences)
      .where(
        and(
          eq(schema.hindiOccurrences.chapterId, token.chapterId),
          eq(schema.hindiOccurrences.sourceStart, start),
        ),
      );
    const supported = new Set(occurrences.map((o) => o.lemmaId));
    const ids = [...new Set(selected)];
    if (ids.some((id) => !supported.has(id)))
      throw new ContextChoiceError('Choose a supported dictionary entry', 400);
    const spans = new Map<number, string[]>();
    for (const o of occurrences)
      spans.set(o.sourceEnd, [...(spans.get(o.sourceEnd) ?? []), o.lemmaId]);
    for (const old of existing) if (!spans.has(old.sourceEnd)) spans.set(old.sourceEnd, []);
    const hash = createHash('md5').update(row.chapter.body).digest('hex');
    for (const [end, candidates] of spans) {
      const chosen = ids.filter((id) => candidates.includes(id));
      const previous = existing.filter((c) => c.sourceEnd === end);
      const rows = previous.length
        ? previous
        : [
            {
              sourceOccurrenceId: `parhiba:${start}:${end}`,
              metadata: {} as Record<string, unknown>,
              selectedLemmaIds: [],
              status: 'unconfirmed',
            },
          ];
      for (const old of rows) {
        const reviews = Array.isArray(old.metadata.context_reviews)
          ? old.metadata.context_reviews
          : [];
        const metadata = {
          ...old.metadata,
          chapter_hash: hash,
          context_reviews: [
            ...reviews,
            {
              actor_id: actor.id,
              at: new Date().toISOString(),
              selected_lemma_ids: chosen,
              previous_selected_lemma_ids: old.selectedLemmaIds,
              previous_status: old.status,
              origin: ai ? 'ai' : 'human',
              ...(ai ?? {}),
            },
          ],
        };
        const values = {
          chapterId: token.chapterId,
          sourceOccurrenceId: old.sourceOccurrenceId,
          sourceStart: start,
          sourceEnd: end,
          selectedLemmaIds: chosen,
          candidateLemmaIds: candidates,
          origin: ai ? 'ai' : 'human',
          status: chosen.length
            ? ai
              ? 'ai_suggested'
              : 'confirmed'
            : ai?.outcome === 'selected'
              ? 'unconfirmed'
              : (ai?.outcome ?? 'unconfirmed'),
          metadata,
        };
        await tx
          .insert(schema.hindiContextChoices)
          .values(values)
          .onConflictDoUpdate({
            target: [
              schema.hindiContextChoices.chapterId,
              schema.hindiContextChoices.sourceOccurrenceId,
            ],
            set: values,
          });
      }
    }
    if (!ai)
      await tx
        .delete(schema.tokenCorrections)
        .where(
          and(
            eq(schema.tokenCorrections.userId, actor.id),
            eq(schema.tokenCorrections.tokenId, tokenId),
          ),
        );
    return token.chapterId;
  });
}

/** Current source offsets keep imported decisions independent of token row IDs. */
export async function loadHindiContextChoices(
  chapterId: string,
): Promise<Map<number, HindiContextChoice>> {
  const rows = await db.execute(sql`
    SELECT c.source_start,c.selected_lemma_ids,c.candidate_lemma_ids,c.origin,c.status,
      md5(ch.body)=c.metadata->>'chapter_hash' AS text_matches,
      COALESCE(array_agg(o.lemma_id::text) FILTER (WHERE o.lemma_id IS NOT NULL), ARRAY[]::text[]) AS supported
    FROM hindi_context_choices c JOIN text_chapters ch ON ch.id=c.chapter_id
    LEFT JOIN hindi_occurrences o ON o.chapter_id=c.chapter_id
      AND o.source_start=c.source_start AND o.source_end=c.source_end
    WHERE c.chapter_id=${chapterId}
    GROUP BY c.chapter_id,c.source_occurrence_id,ch.body
    ORDER BY c.source_start,c.source_end
  `);
  const out = new Map<number, HindiContextChoice>();
  for (const row of rows) {
    const selected = row.selected_lemma_ids as string[];
    const expected = new Set(row.candidate_lemma_ids as string[]);
    const supported = new Set(row.supported as string[]);
    const matches =
      row.text_matches &&
      expected.size === supported.size &&
      [...expected].every((id) => supported.has(id));
    const status = matches ? String(row.status) : 'needs_review';
    const valid = status === 'confirmed' || status === 'ai_suggested';
    const start = Number(row.source_start);
    const previous = out.get(start);
    // At overlapping spans retain every selected entry, including compounds.
    const ids = valid ? selected.filter((id) => supported.has(id)) : [];
    out.set(start, {
      selectedLemmaIds: [...new Set([...(previous?.selectedLemmaIds ?? []), ...ids])],
      selectedOrigins: {
        ...previous?.selectedOrigins,
        ...Object.fromEntries(ids.map((id) => [id, row.origin === 'human' ? 'human' : 'ai'])),
      },
      origin: previous?.origin === 'human' || row.origin === 'human' ? 'human' : 'ai',
      status: previous?.selectedLemmaIds.length ? previous.status : status,
    });
  }
  return out;
}
