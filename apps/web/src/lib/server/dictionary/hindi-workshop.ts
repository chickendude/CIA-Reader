import { sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { previewHindiEntry } from './hindi-runtime.js';
import { hindiPatterns } from '$lib/dictionary/hindi-patterns';
import {
  partsOfSpeech,
  normalizeHindiForm,
  type Draft,
  type Inventory,
  type Match,
  type Excerpt,
} from '$lib/dictionary/hindi-workshop';

const word = z
  .string()
  .trim()
  .min(1)
  .max(400)
  .transform(normalizeHindiForm);
const words = z.array(word).max(12000);
const slot = z
  .object({
    id: z.string(),
    label: z.string(),
    forms: words,
    include: z.boolean(),
    applicability: z.enum(['applicable', 'unknown', 'not_applicable']),
  })
  .passthrough();
export const draftInput = z.object({
  id: z.string().uuid().nullable(),
  version: z.string(),
  lemma: word,
  pos: z.string().refine((s) => Object.hasOwn(partsOfSpeech, s)),
  meaning: z.string().trim().max(64000),
  paradigm: z.string().max(80),
  alternatives: words,
  other: words,
  excluded: words,
  loan: z.boolean(),
  inventory: z
    .object({
      version: z.string(),
      lemma: z.string(),
      pos: z.string(),
      paradigm: z.string(),
      slots: z.array(slot).max(240),
    })
    .nullable(),
  excerpts: z
    .array(
      z.object({
        url: z.string().max(2048),
        original: z.string().max(16000),
        english: z.string().max(16000),
      }),
    )
    .max(100),
});

type Executor = Pick<typeof db, 'execute'>;
type Source = Record<string, unknown> & {
  paradigm?: string;
  alternative_headwords?: string[];
  excluded_forms?: string[];
  english_loan?: boolean;
  form_inventory?: Inventory;
  workshop_excerpts?: Excerpt[];
  definitions?: {
    language?: string;
    original?: string;
    translation?: string;
    source_url?: string;
  }[];
  group_id?: string;
  group_primary?: string;
  group_uses?: { id: string; pos: string }[];
};
async function readEntry(id: string, conn: Executor = db) {
  const [row] = await conn.execute<{
    id: string;
    lemma: string;
    pos: string;
    meaning: string;
    external: string;
    entry: Source;
    forms: string[];
    inferred_loan: boolean;
  }>(sql`
    SELECT l.id,l.headword lemma,l.pos,coalesce(l.gloss_default,'') meaning,h.external_id external,h.entry,
      EXISTS(SELECT 1 FROM hindi_reference_cache WHERE key='loan:'||h.lemma_id) inferred_loan,
      ARRAY(SELECT DISTINCT surface FROM lemma_forms WHERE lemma_id=l.id AND quarantined_at IS NULL ORDER BY surface) forms
    FROM lemmas l JOIN hindi_entries h ON h.lemma_id=l.id WHERE l.id=${id} AND l.language='hi'`);
  if (!row) error(404, 'Hindi dictionary entry not found');
  const { entry, forms } = row;
  const inventory = entry.form_inventory ?? null;
  const included = new Set(inventory?.slots.filter((s) => s.include).flatMap((s) => s.forms));
  const draft: Draft = {
    id,
    version: createHash('sha256').update(JSON.stringify(row)).digest('hex'),
    lemma: row.lemma,
    pos: row.pos,
    meaning: row.meaning,
    paradigm: entry.paradigm ?? 'invariant',
    alternatives: entry.alternative_headwords ?? [],
    other: forms.filter((f) => !included.has(f)),
    excluded: entry.excluded_forms ?? [],
    loan: entry.english_loan ?? row.inferred_loan,
    inventory,
    excerpts: entry.workshop_excerpts ?? [],
  };
  return { draft, entry, external: row.external };
}
export async function getWorkshopWord(id: string) {
  const { draft, entry, external } = await readEntry(id);
  const uses =
    await db.execute<Match>(sql`SELECT id,headword lemma,pos,coalesce(gloss_default,'') meaning
    FROM lemmas WHERE language='hi' AND headword=${draft.lemma} ORDER BY pos`);
  const group = (entry.group_uses ?? [])
    .map((use) => use.id)
    .filter((id) => uses.some((u) => u.id === id));
  // The workshop shows the primary use first.
  const primary = entry.group_primary;
  if (primary) group.sort((a, b) => Number(b === primary) - Number(a === primary));
  const evidence = (entry.definitions ?? []).map((d) => ({
    url: d.source_url ?? '',
    original: d.original ?? '',
    english: d.translation ?? (d.language === 'en' ? d.original : '') ?? '',
  }));
  const [archive] = await db.execute<{ result: Excerpt[] }>(
    sql`SELECT result FROM hindi_reference_cache WHERE key=${'excerpts:' + draft.lemma}`,
  );
  return {
    draft,
    external,
    uses: [...uses],
    group,
    evidence: [...evidence, ...(archive?.result ?? [])],
  };
}
export async function searchHindi(query: string, limit: number, offset = 0) {
  const term = '%' + query.replace(/[\\%_]/g, '\\$&') + '%';
  return [
    ...(await db.execute<Match>(sql`SELECT l.id,l.headword lemma,l.pos,coalesce(l.gloss_default,'') meaning
    FROM lemmas l JOIN hindi_entries h ON h.lemma_id=l.id WHERE l.language='hi' AND
    (l.headword ILIKE ${term} OR l.gloss_default ILIKE ${term} OR l.headword_nukta_stripped ILIKE translate(normalize(${term},NFD),'़','')
      OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(h.entry->'alternative_headwords') alt WHERE alt ILIKE ${term})
      OR EXISTS(SELECT 1 FROM lemma_forms f WHERE f.lemma_id=l.id AND f.surface=${query} AND f.quarantined_at IS NULL))
    ORDER BY (l.headword=${query}) DESC,l.headword,l.pos,l.id LIMIT ${limit} OFFSET ${offset}`)),
  ];
}
function lexicalEntry(d: Draft, raw: Source) {
  if (
    !hindiPatterns(d.lemma, d.pos, '').some((p) => p.id === d.paradigm) &&
    d.paradigm !== raw.paradigm
  )
    error(400, 'Choose a pattern for this part of speech and spelling');
  const forms = [
    ...new Set([
      ...d.other,
      ...(d.inventory?.slots.filter((s) => s.include).flatMap((s) => s.forms) ?? []),
    ]),
  ];
  return {
    ...raw,
    lemma: d.lemma,
    pos: d.pos,
    paradigm: d.paradigm,
    forms,
    alternative_headwords: d.alternatives,
    excluded_forms: d.excluded,
    form_inventory: d.inventory,
    english_loan: d.loan,
    workshop_excerpts: d.excerpts,
    source: raw.source ?? 'Parhiba curator',
  };
}
export async function previewDraft(d: Draft, inventory: boolean) {
  const raw = d.id ? (await readEntry(d.id)).entry : {};
  const entry = lexicalEntry(d, raw);
  if (inventory) {
    const [foundation] = await db.execute<{
      evidence: Record<string, unknown[]>;
    }>(sql`SELECT result->'form_evidence' evidence
      FROM hindi_reference_cache WHERE key=${'foundation:' + lexicalId(d.lemma, d.pos)}`);
    const existing = (raw.form_evidence as Record<string, unknown[]>) ?? {};
    const evidence = { ...existing };
    for (const [surface, records] of Object.entries(foundation?.evidence ?? {})) {
      evidence[surface] = [
        ...new Map(
          [...(existing[surface] ?? []), ...records].map((r) => [JSON.stringify(r), r]),
        ).values(),
      ];
    }
    return previewHindiEntry({ ...entry, form_evidence: evidence }, { inventory });
  }
  return previewHindiEntry(entry, { inventory });
}
export async function saveDraft(d: Draft, actor: string) {
  return db.transaction(async (tx) => {
    const id = d.id ?? randomUUID();
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('hindi-workshop'),hashtext(${d.lemma}))`,
    );
    if (d.id) await tx.execute(sql`SELECT id FROM lemmas WHERE id=${id} FOR UPDATE`);
    const current = d.id ? await readEntry(id, tx) : null;
    if (current && current.draft.version !== d.version)
      error(409, 'This entry changed since you opened it. Reopen it before saving.');
    const [duplicate] = await tx.execute(
      sql`SELECT id FROM lemmas WHERE language='hi' AND headword=${d.lemma} AND pos=${d.pos} AND id<>${id}`,
    );
    if (duplicate)
      error(
        409,
        'This dictionary form and part of speech already exist. Select the existing entry.',
      );
    const entry = lexicalEntry(d, current?.entry ?? {});
    await previewHindiEntry(entry, { validate_inventory: true });
    if (current?.entry.group_id && (d.lemma !== current.draft.lemma || d.pos !== current.draft.pos))
      error(409, 'Ungroup this POS use before changing its identity.');
    if (current)
      await tx.execute(
        sql`UPDATE lemmas SET headword=${d.lemma},pos=${d.pos},updated_at=now() WHERE id=${id}`,
      );
    else
      await tx
        .insert(schema.lemmas)
        .values({
          id,
          language: 'hi',
          headword: d.lemma,
          pos: d.pos,
          script: 'Deva',
          source: 'curator',
          curatorLocked: true,
        });
    const formList = JSON.stringify(entry.forms);
    await tx.execute(
      sql`DELETE FROM lemma_forms WHERE lemma_id=${id} AND quarantined_at IS NULL AND NOT (${formList}::text::jsonb ? surface)`,
    );
    await tx.execute(sql`INSERT INTO lemma_forms(lemma_id,surface,created_by)
      SELECT ${id},value,'curator' FROM jsonb_array_elements_text(${formList}::text::jsonb) WHERE NOT EXISTS
      (SELECT 1 FROM lemma_forms WHERE lemma_id=${id} AND surface=value AND quarantined_at IS NULL)`);
    const saved = {
      ...entry,
      review_status: 'reviewed',
      reviewer: actor,
      reviewed_at: new Date().toISOString(),
    };
    await tx
      .insert(schema.hindiEntries)
      .values({ lemmaId: id, externalId: 'parhiba:' + id, entry: saved })
      .onConflictDoUpdate({ target: schema.hindiEntries.lemmaId, set: { entry: saved } });
    if (d.meaning !== (current?.draft.meaning ?? '')) {
      const canonical = sql`target_id=${id} AND target_type='lemma' AND target_language='en' AND source IN ('curator','official_dictionary') AND NOT hidden`;
      const [first] = await tx.execute<{ id: string }>(
        sql`SELECT id FROM translations WHERE ${canonical} ORDER BY display_rank NULLS LAST,created_at,id LIMIT 1`,
      );
      if (first) {
        await tx.execute(
          sql`UPDATE translations SET hidden=true WHERE ${canonical} AND id<>${first.id}`,
        );
        await tx.execute(
          sql`UPDATE translations SET body=coalesce(nullif(${d.meaning},''),body),hidden=${!d.meaning},updated_at=now() WHERE id=${first.id}`,
        );
      } else if (d.meaning)
        await tx
          .insert(schema.translations)
          .values({
            targetId: id,
            targetType: 'lemma',
            source: 'curator',
            body: d.meaning,
            targetLanguage: 'en',
          });
    }
    await tx
      .insert(schema.lemmaEditHistory)
      .values({
        lemmaId: id,
        editorId: actor,
        changeType: 'lemma_update',
        reason: 'Hindi dictionary workshop',
        change: { before: current?.draft ?? {}, after: d },
      });
    return id;
  });
}
function lexicalId(lemma: string, pos: string) {
  return (
    'hi_' +
    createHash('sha256')
      .update(['hi', lemma.normalize('NFC'), pos].join('\0'))
      .digest('hex')
      .slice(0, 24)
  );
}
export async function groupUses(id: string, members: string[], actor: string) {
  if (new Set(members).size !== members.length || (members.length && !members.includes(id)))
    error(400, 'Select distinct uses including the active word');
  await db.transaction(async (tx) => {
    const base = await readEntry(id, tx);
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('hindi-workshop'),hashtext(${base.draft.lemma}))`,
    );
    const rows = await tx.execute<{
      id: string;
      pos: string;
      entry: Source;
    }>(sql`SELECT l.id,l.pos,h.entry FROM lemmas l JOIN hindi_entries h ON h.lemma_id=l.id
      WHERE l.language='hi' AND l.headword=${base.draft.lemma} ORDER BY l.id FOR UPDATE`);
    const active = rows.find((r) => r.id === id);
    if (!active || members.some((m) => !rows.some((r) => r.id === m)))
      error(409, 'These POS uses no longer share a dictionary form');
    const gid = active.entry.group_id ?? randomUUID();
    const uses = members.map((id) => ({ id, pos: rows.find((row) => row.id === id)!.pos }));
    for (const row of rows) {
      if (!members.includes(row.id) && row.entry.group_id !== gid) continue;
      if (row.entry.group_id && row.entry.group_id !== gid)
        error(409, 'Ungroup this use from its current word first');
      const entry = { ...row.entry };
      delete entry.group_uses;
      delete entry.group_primary;
      delete entry.group_id;
      if (members.includes(row.id) && uses.length > 1)
        Object.assign(entry, { group_id: gid, group_uses: uses, group_primary: uses[0]!.id });
      await tx.execute(
        sql`UPDATE hindi_entries SET entry=${JSON.stringify(entry)}::text::jsonb WHERE lemma_id=${row.id}`,
      );
      await tx
        .insert(schema.lemmaEditHistory)
        .values({
          lemmaId: row.id,
          editorId: actor,
          changeType: 'lemma_update',
          change: { before: row.entry, after: entry },
          reason: 'Group Hindi POS uses',
        });
    }
  });
}

type WorkshopTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function mergeHindiWords(
  tx: WorkshopTransaction,
  id: string,
  target: string,
  actor: string,
  version?: string,
  spellingOnly = false,
) {
  if (id === target) error(400, 'Choose a different destination');
  await tx.execute(sql`SELECT id FROM lemmas WHERE id IN (${id},${target}) ORDER BY id FOR UPDATE`);
  const from = await readEntry(id, tx),
    to = await readEntry(target, tx);
  if (version && from.draft.version !== version)
    error(409, 'The source entry changed. Reopen it before merging.');
  if (from.entry.group_id) error(409, 'Ungroup the source POS use before merging.');
  const fromForms = await previewHindiEntry(lexicalEntry(from.draft, from.entry));
  const aliases = [
    ...new Set([
      ...((to.entry.merged_entry_ids as string[]) ?? []),
      from.external,
      ...((from.entry.merged_entry_ids as string[]) ?? []),
    ]),
  ];
  const entry = {
    ...to.entry,
    merged_entry_ids: aliases,
    alternative_headwords: [
      ...new Set([...to.draft.alternatives, ...from.draft.alternatives, from.draft.lemma]),
    ].filter((w) => w !== to.draft.lemma),
    workshop_excerpts: [...to.draft.excerpts, ...from.draft.excerpts],
    definitions: spellingOnly
      ? to.entry.definitions
      : [...(to.entry.definitions ?? []), ...(from.entry.definitions ?? [])],
  };
  // Keep current scheduling and mined context together when both statuses exist.
  await tx.execute(sql`INSERT INTO user_known_lemmas(user_id,lemma_id,status,updated_at,mined_sentence,mined_chapter_id,mined_token_idx)
    SELECT user_id,${target},status,updated_at,mined_sentence,mined_chapter_id,mined_token_idx FROM user_known_lemmas WHERE lemma_id=${id}
    ON CONFLICT(user_id,lemma_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at,
      mined_sentence=coalesce(excluded.mined_sentence,user_known_lemmas.mined_sentence),
      mined_chapter_id=coalesce(excluded.mined_chapter_id,user_known_lemmas.mined_chapter_id),
      mined_token_idx=coalesce(excluded.mined_token_idx,user_known_lemmas.mined_token_idx)
    WHERE excluded.updated_at>user_known_lemmas.updated_at`);
  await tx.execute(sql`UPDATE user_languages ul SET known_words_count_cache=(SELECT count(*) FROM user_known_lemmas k JOIN lemmas l ON l.id=k.lemma_id
    WHERE k.user_id=ul.user_id AND k.status='known' AND l.language='hi' AND l.id<>${id})
    WHERE ul.language='hi' AND EXISTS(SELECT 1 FROM user_known_lemmas k WHERE k.user_id=ul.user_id AND k.lemma_id=${id})`);
  if (spellingOnly)
    await tx.execute(
      sql`UPDATE translations SET hidden=true WHERE target_id=${id} AND target_type='lemma' AND source IN ('official_dictionary','curator')`,
    );
  await tx.execute(
    sql`UPDATE translations SET target_id=${target} WHERE target_type='lemma' AND target_id=${id}`,
  );
  await tx.execute(sql`UPDATE lemma_forms SET lemma_id=${target} WHERE lemma_id=${id}`);
  await tx.execute(sql`INSERT INTO lemma_forms(lemma_id,surface,created_by) SELECT ${target},value,'curator'
    FROM jsonb_array_elements_text(${JSON.stringify(Object.keys(fromForms.forms))}::text::jsonb)
    WHERE NOT EXISTS(SELECT 1 FROM lemma_forms WHERE lemma_id=${target} AND surface=value AND quarantined_at IS NULL)`);
  await tx.execute(
    sql`UPDATE hindi_entries SET entry=${JSON.stringify(entry)}::text::jsonb WHERE lemma_id=${target}`,
  );
  await tx.execute(sql`UPDATE text_tokens SET lemma_id=${target} WHERE lemma_id=${id}`);
  await tx.execute(sql`UPDATE text_tokens t SET lemma_candidates=(SELECT jsonb_agg(CASE WHEN c->>'lemmaId'=${id} THEN
    jsonb_set(c,'{lemmaId}',to_jsonb(${target}::text)) ELSE c END ORDER BY n) FROM jsonb_array_elements(t.lemma_candidates) WITH ORDINALITY v(c,n))
    WHERE t.lemma_candidates @> jsonb_build_array(jsonb_build_object('lemmaId',${id}::text))`);
  await tx.execute(sql`DELETE FROM hindi_occurrences a USING hindi_occurrences b WHERE a.lemma_id=${id} AND b.lemma_id=${target}
    AND a.chapter_id=b.chapter_id AND a.start_idx=b.start_idx AND a.end_idx=b.end_idx`);
  await tx.execute(sql`UPDATE hindi_occurrences SET lemma_id=${target} WHERE lemma_id=${id}`);
  for (const column of [sql`selected_lemma_ids`, sql`candidate_lemma_ids`]) {
    await tx.execute(sql`UPDATE hindi_context_choices SET ${column}=(SELECT jsonb_agg(val ORDER BY n)
      FROM (SELECT CASE WHEN v=${id} THEN ${target} ELSE v END val,min(n) n
        FROM jsonb_array_elements_text(${column}) WITH ORDINALITY a(v,n) GROUP BY 1) merged)
      WHERE ${column} ? ${id}`);
  }
  await tx
    .insert(schema.lemmaEditHistory)
    .values({
      lemmaId: target,
      editorId: actor,
      changeType: 'lemma_merge',
      change: {
        before: from.entry,
        after: entry,
        mergedFrom: { ...from.draft, externalId: from.external },
      },
      reason: 'Hindi dictionary workshop',
    });
  await tx.execute(sql`DELETE FROM lemmas WHERE id=${id}`);
}
