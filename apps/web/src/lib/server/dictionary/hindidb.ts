import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { User } from '../db/schema.js';
import { requireCanEditDictionary } from './permissions.js';
import { previewHindiEntry } from './hindi-runtime.js';
import { replacePatternForms } from './pattern-forms.js';

import { hindiPatterns } from '$lib/dictionary/hindi-patterns.js';
import { formatAlternativeHeadwords, parseAlternativeHeadwords } from '$lib/dictionary/workshop';

type ReviewedSlot = { label: string; forms: string[]; include: boolean };

export async function listHindiPatterns(ids: string[]) {
  if (!ids.length) return {};
  const rows = await db
    .select({
      id: schema.dictionaryEntries.lemmaId,
      pattern: sql<string>`coalesce(${schema.dictionaryEntries.entry}->>'paradigm', 'invariant')`,
    })
    .from(schema.dictionaryEntries)
    .where(inArray(schema.dictionaryEntries.lemmaId, ids));
  return Object.fromEntries(rows.map((row) => [row.id, row.pattern])) as Record<string, string>;
}

export async function singleHindiDefinitions(ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const t = schema.translations;
  const rows = await db
    .select({ lemmaId: t.targetId, id: sql<string>`min(${t.id}::text)` })
    .from(t)
    .where(
      and(
        inArray(t.targetId, ids),
        eq(t.targetType, 'lemma'),
        eq(t.targetLanguage, 'en'),
        inArray(t.source, ['curator', 'official_dictionary']),
        eq(t.hidden, false),
      ),
    )
    .groupBy(t.targetId)
    .having(sql`count(*) = 1`);
  return Object.fromEntries(rows.map((row) => [row.lemmaId, row.id]));
}

export async function getHindiEntry(id: string) {
  const [lemma] = await db.select().from(schema.lemmas).where(eq(schema.lemmas.id, id));
  if (!lemma || lemma.language !== 'hi') return null;
  const [stored] = await db
    .select()
    .from(schema.dictionaryEntries)
    .where(eq(schema.dictionaryEntries.lemmaId, id));
  const forms = await db.select().from(schema.lemmaForms).where(eq(schema.lemmaForms.lemmaId, id));
  const entry = stored?.entry ?? {};
  return {
    entry: {
      ...entry,
      lemma: lemma.headword,
      pos: lemma.pos,
      source: entry.source ?? 'Parhiba curator',
      forms: forms.filter((f) => !f.quarantinedAt).map((f) => f.surface),
    },
    paradigm: String(entry.paradigm ?? 'invariant'),
    alternatives: (entry.alternative_headwords ?? []) as string[],
    editableAlternatives: formatAlternativeHeadwords(
      (entry.alternative_headwords ?? []) as string[],
      (entry.hidden_alternative_headwords ?? []) as string[],
    ),
    excluded: (entry.excluded_forms ?? []) as string[],
    forms: forms.filter((f) => !f.quarantinedAt).map((f) => f.surface),
    reviewedSlots: (
      (entry.form_inventory as { slots?: ReviewedSlot[] } | undefined)?.slots ?? []
    ).map(({ label, forms, include }) => ({ label, forms, include })),
    reviewStatus: String(entry.review_status ?? 'provisional'),
  };
}

export async function saveHindiMorphology(
  user: Pick<User, 'id' | 'role'>,
  id: string,
  form: FormData,
) {
  await requireCanEditDictionary(user, 'hi');
  const current = await getHindiEntry(id);
  if (!current) throw new Error('Hindi entry not found');
  const lines = (key: string) => [
    ...new Set(
      String(form.get(key) ?? '')
        .split(/\r?\n/)
        .map((v) => v.trim().normalize('NFC'))
        .filter(Boolean),
    ),
  ];
  const paradigm = String(form.get('paradigm') ?? 'invariant');
  if (
    !hindiPatterns(current.entry.lemma, current.entry.pos, current.paradigm).some(
      (p) => p.id === paradigm,
    )
  )
    throw new Error('Unknown Hindi paradigm');
  const { alternatives, hiddenAlternatives } = parseAlternativeHeadwords(lines('alternatives'));
  const entry = {
    ...current.entry,
    paradigm,
    forms: lines('forms'),
    alternative_headwords: alternatives,
    hidden_alternative_headwords: hiddenAlternatives,
    excluded_forms: lines('excluded'),
    review_status: 'reviewed',
    reviewed_at: new Date().toISOString(),
    reviewer: user.id,
  };
  const preview = await previewHindiEntry(entry);
  await db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(schema.lemmaForms)
      .where(eq(schema.lemmaForms.lemmaId, id));
    const removed = existing.filter((f) => !entry.forms.includes(f.surface)).map((f) => f.id);
    if (removed.length)
      await tx.delete(schema.lemmaForms).where(inArray(schema.lemmaForms.id, removed));
    const existingSurfaces = new Set(
      existing.filter((f) => !f.quarantinedAt).map((f) => f.surface),
    );
    const added = entry.forms.filter((surface) => !existingSurfaces.has(surface));
    if (added.length)
      await tx
        .insert(schema.lemmaForms)
        .values(added.map((surface) => ({ lemmaId: id, surface, createdBy: 'curator' as const })));
    // The full editor's explicit exclusions take precedence over the generic
    // form-delete trigger. Preview and the saved parser input must match.
    await tx
      .insert(schema.dictionaryEntries)
      .values({ lemmaId: id, externalId: `parhiba:${id}`, entry })
      .onConflictDoUpdate({ target: schema.dictionaryEntries.lemmaId, set: { entry } });
    await replacePatternForms(tx, id, preview.forms);
    await tx.insert(schema.lemmaEditHistory).values({
      lemmaId: id,
      editorId: user.id,
      changeType: 'lemma_update',
      change: { before: current.entry, after: entry },
      reason: 'HindiDB morphology edit',
    });
  });
  return Object.keys(preview.forms).length;
}

export async function hindiPatternPreviews(
  current: NonNullable<Awaited<ReturnType<typeof getHindiEntry>>>,
) {
  const { lemma, pos, source } = current.entry;
  return Promise.all(
    hindiPatterns(lemma, pos, current.paradigm).map(async ({ id, label }) => {
      if (id === 'invariant') return { id, label, forms: [], slots: [] };
      try {
        const preview = await previewHindiEntry(
          { lemma, pos, source, paradigm: id, alternative_headwords: current.alternatives },
          { include_slots: true },
        );
        return { id, label, forms: Object.keys(preview.forms), slots: preview.slots ?? [] };
      } catch {
        return { id, label, forms: null, slots: [] };
      }
    }),
  );
}
