import { sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { archiveKey, workshopAdapter } from './workshop-adapters';
import { getLanguage, type LanguageCode } from '@ciareader/shared-types';
import { dictionaryProfile } from '$lib/dictionary/profiles';
import { type Draft, type Inventory, type Match, type Excerpt } from '$lib/dictionary/workshop';

export function draftInputFor(language: LanguageCode) {
  const profile = dictionaryProfile(language);
  const word = z.string().trim().min(1).max(400).transform(profile.normalize);
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
  return z.object({
    id: z.string().uuid().nullable(),
    version: z.string(),
    lemma: word,
    pos: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .refine((s) => !profile.strictPartsOfSpeech || Object.hasOwn(profile.partsOfSpeech, s)),
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
}

type Executor = Pick<typeof db, 'execute'>;
type Source = Record<string, unknown> & {
  paradigm?: string;
  form_evidence?: Record<string, unknown[]>;
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
async function readEntry(language: LanguageCode, id: string, conn: Executor = db) {
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
    SELECT l.id,l.headword lemma,l.pos,coalesce(l.gloss_default,'') meaning,coalesce(h.external_id,'parhiba:'||l.id) external,coalesce(h.entry,'{}'::jsonb) entry,
      EXISTS(SELECT 1 FROM hindi_reference_cache WHERE key=${archiveKey(language, 'loan:')}||h.lemma_id) inferred_loan,
      ARRAY(SELECT DISTINCT surface FROM lemma_forms WHERE lemma_id=l.id AND quarantined_at IS NULL ORDER BY surface) forms
    FROM lemmas l LEFT JOIN dictionary_entries h ON h.lemma_id=l.id WHERE l.id=${id} AND l.language=${language} AND (NOT ${dictionaryProfile(language).requiresStoredEntry}::boolean OR h.lemma_id IS NOT NULL)`);
  if (!row) error(404, 'Dictionary entry not found');
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
export async function getWorkshopWord(id: string, language: LanguageCode) {
  const { draft, entry, external } = await readEntry(language, id);
  const uses =
    await db.execute<Match>(sql`SELECT id,headword lemma,pos,coalesce(gloss_default,'') meaning
    FROM lemmas WHERE language=${language} AND headword=${draft.lemma} ORDER BY pos`);
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
    sql`SELECT result FROM hindi_reference_cache WHERE key=${archiveKey(language, 'excerpts:' + draft.lemma)}`,
  );
  return {
    draft,
    external,
    uses: [...uses],
    group,
    evidence: [...evidence, ...(archive?.result ?? [])],
  };
}
export async function searchWorkshop(
  language: LanguageCode,
  query: string,
  limit: number,
  offset = 0,
) {
  const term = '%' + query.replace(/[\\%_]/g, '\\$&') + '%';
  return [
    ...(await db.execute<Match>(sql`SELECT l.id,l.headword lemma,l.pos,coalesce(l.gloss_default,'') meaning
    FROM lemmas l LEFT JOIN dictionary_entries h ON h.lemma_id=l.id WHERE l.language=${language}
      AND (NOT ${dictionaryProfile(language).requiresStoredEntry}::boolean OR h.lemma_id IS NOT NULL) AND
    (l.headword ILIKE ${term} OR l.gloss_default ILIKE ${term} OR ${workshopAdapter(language).searchSpelling?.(term) ?? sql`FALSE`}
      OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(h.entry->'alternative_headwords') alt WHERE alt ILIKE ${term})
      OR EXISTS(SELECT 1 FROM dictionary_pattern_forms f WHERE f.lemma_id=l.id AND f.surface=${query})
      OR EXISTS(SELECT 1 FROM lemma_forms f WHERE f.lemma_id=l.id AND f.surface=${query} AND f.quarantined_at IS NULL))
    ORDER BY (l.headword=${query}) DESC,l.headword,l.pos,l.id LIMIT ${limit} OFFSET ${offset}`)),
  ];
}
function lexicalEntry(language: LanguageCode, d: Draft, raw: Source) {
  if (
    !dictionaryProfile(language)
      .patterns(d.lemma, d.pos, '')
      .some((p) => p.id === d.paradigm) &&
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
type LexicalEntry = ReturnType<typeof lexicalEntry>;
async function previewEntry(
  language: LanguageCode,
  entry: LexicalEntry,
  options: { inventory?: boolean; validate_inventory?: boolean } = {},
) {
  const profile = dictionaryProfile(language);
  const adapter = workshopAdapter(language);
  if (adapter.preview) return adapter.preview(entry, options);
  const forms = new Map<string, string[]>();
  function add(surface: string, rule: string) {
    const key = profile.normalize(surface.trim().replace(/\s+/gu, ' '));
    forms.set(key, [...(forms.get(key) ?? []), rule]);
  }
  add(entry.lemma, 'citation');
  for (const alias of entry.alternative_headwords) add(alias, 'alternative-headword');
  for (const surface of entry.forms) add(surface, 'explicit-form');
  for (const surface of profile.generate(entry.lemma, entry.pos, entry.paradigm))
    add(surface, entry.paradigm);
  const excluded = new Set(
    entry.excluded_forms.map((surface) => profile.normalize(surface).toLowerCase()),
  );
  for (const [surface, rules] of forms) {
    if (!excluded.has(surface.toLowerCase())) continue;
    if (rules.includes('citation') || rules.includes('alternative-headword'))
      error(400, 'Restore the form before using it as a headword');
    forms.delete(surface);
  }
  const inventory = profile.inventory(entry.lemma, entry.pos, entry.paradigm);
  const saved = entry.form_inventory;
  if (
    options.validate_inventory &&
    saved &&
    (saved.lemma !== inventory.lemma ||
      saved.pos !== inventory.pos ||
      saved.paradigm !== inventory.paradigm ||
      saved.version !== inventory.version ||
      saved.slots.some((slot) => !inventory.slots.some((s) => s.id === slot.id)))
  )
    error(400, 'Refresh the inflection slots for this entry');
  return { forms: Object.fromEntries(forms), inventory: options.inventory ? inventory : undefined };
}
export async function previewDraft(language: LanguageCode, d: Draft, inventory: boolean) {
  const raw = d.id ? (await readEntry(language, d.id)).entry : {};
  const entry = lexicalEntry(language, d, raw);
  if (inventory && workshopAdapter(language).preview) {
    const [foundation] = await db.execute<{
      evidence: Record<string, unknown[]>;
    }>(sql`SELECT result->'form_evidence' evidence
      FROM hindi_reference_cache WHERE key=${archiveKey(language, 'foundation:' + lexicalId(language, d.lemma, d.pos))}`);
    const existing = (raw.form_evidence as Record<string, unknown[]>) ?? {};
    const evidence = { ...existing };
    for (const [surface, records] of Object.entries(foundation?.evidence ?? {})) {
      evidence[surface] = [
        ...new Map(
          [...(existing[surface] ?? []), ...records].map((r) => [JSON.stringify(r), r]),
        ).values(),
      ];
    }
    return previewEntry(language, { ...entry, form_evidence: evidence }, { inventory });
  }
  return previewEntry(language, entry, { inventory });
}
export async function previewPhrase(
  language: LanguageCode,
  phrase: string,
  verb: string,
  negative: boolean,
) {
  const profile = dictionaryProfile(language);
  const words = profile.normalize(phrase).trim().split(/\s+/u);
  verb = profile.normalize(verb);
  const index = words.indexOf(verb);
  if (words.length < 2 || index < 0 || words.lastIndexOf(verb) !== index)
    error(400, 'The phrase must contain the selected verb exactly once as a whole word');
  if (words.some((word) => !profile.phraseWord.test(word)))
    error(400, 'Enter the phrase without punctuation');
  const [row] = await db.execute<{ id: string }>(
    sql`SELECT id FROM lemmas WHERE language=${language} AND headword=${verb}
      AND upper(pos) IN ('VERB','AUX') ORDER BY upper(pos) DESC,id LIMIT 1`,
  );
  if (!row) error(400, 'Add the verb and its forms to this dictionary first');
  const { draft, entry } = await readEntry(language, row.id);
  const lexical = lexicalEntry(language, draft, entry);
  const adapter = workshopAdapter(language);
  const frames = [words];
  if (negative) {
    const variants = profile.negativeVariants ?? [];
    if (index === 0 || !variants.includes(words[index - 1]!))
      error(400, 'Select a phrase with a configured negative marker before the verb');
    for (const variant of variants.filter((v) => v !== words[index - 1])) {
      const frame = [...words];
      frame[index - 1] = variant;
      frames.push(frame);
    }
  }
  const candidates = await (adapter.phraseForms?.(lexical) ?? previewEntry(language, lexical));
  const provenance = [
    'phrase:verb-substitution',
    'phrase:verb-entry:' + lexicalId(language, verb, draft.pos),
  ];
  const forms: Record<string, string[]> = {};
  for (const frame of frames) {
    for (const surface of Object.keys(candidates.forms)) {
      if (!profile.phraseWord.test(surface)) continue;
      const result = [...frame];
      result[index] = surface;
      forms[result.join(' ')] = provenance;
    }
  }
  return { forms };
}

export async function saveDraft(d: Draft, actor: string, language: LanguageCode) {
  return db.transaction(async (tx) => {
    const id = d.id ?? randomUUID();
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${'workshop:' + language}),hashtext(${d.lemma}))`,
    );
    if (d.id) await tx.execute(sql`SELECT id FROM lemmas WHERE id=${id} FOR UPDATE`);
    const current = d.id ? await readEntry(language, id, tx) : null;
    if (current && current.draft.version !== d.version)
      error(409, 'This entry changed since you opened it. Reopen it before saving.');
    const [duplicate] = await tx.execute(
      sql`SELECT id FROM lemmas WHERE language=${language} AND headword=${d.lemma} AND pos=${d.pos} AND id<>${id}`,
    );
    if (duplicate && (!current || current.draft.lemma !== d.lemma || current.draft.pos !== d.pos))
      error(
        409,
        'This dictionary form and part of speech already exist. Select the existing entry.',
      );
    const entry = lexicalEntry(language, d, current?.entry ?? {});
    const preview = await previewEntry(language, entry, { validate_inventory: true });
    if (current?.entry.group_id && (d.lemma !== current.draft.lemma || d.pos !== current.draft.pos))
      error(409, 'Ungroup this POS use before changing its identity.');
    if (current)
      await tx.execute(
        sql`UPDATE lemmas SET headword=${d.lemma},pos=${d.pos},curator_locked=true,updated_at=now() WHERE id=${id}`,
      );
    else
      await tx.insert(schema.lemmas).values({
        id,
        language,
        headword: d.lemma,
        pos: d.pos,
        script: getLanguage(language).script,
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
      .insert(schema.dictionaryEntries)
      .values({ lemmaId: id, externalId: 'parhiba:' + id, entry: saved })
      .onConflictDoUpdate({ target: schema.dictionaryEntries.lemmaId, set: { entry: saved } });
    const generated = Object.entries(preview.forms)
      .filter(([, rules]) => rules.some((rule) => rule !== 'citation' && rule !== 'explicit-form'))
      .map(([surface]) => surface);
    await tx.execute(sql`DELETE FROM dictionary_pattern_forms WHERE lemma_id=${id}`);
    await tx.execute(sql`INSERT INTO dictionary_pattern_forms(lemma_id,surface)
      SELECT ${id}, value FROM jsonb_array_elements_text(${JSON.stringify(generated)}::text::jsonb)`);
    if (d.meaning !== (current?.draft.meaning ?? '')) {
      const canonical = sql`target_id=${id} AND target_type='lemma' AND target_language='en' AND source IN ('curator','official_dictionary') AND NOT hidden AND NOT is_private`;
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
        await tx.insert(schema.translations).values({
          targetId: id,
          targetType: 'lemma',
          source: 'curator',
          body: d.meaning,
          targetLanguage: 'en',
        });
    }
    await tx.insert(schema.lemmaEditHistory).values({
      lemmaId: id,
      editorId: actor,
      changeType: 'lemma_update',
      reason: 'Dictionary workshop',
      change: { before: current?.draft ?? {}, after: d },
    });
    return id;
  });
}
function lexicalId(language: LanguageCode, lemma: string, pos: string) {
  return (
    language +
    '_' +
    createHash('sha256')
      .update([language, lemma.normalize('NFC'), pos].join('\0'))
      .digest('hex')
      .slice(0, 24)
  );
}
export async function groupUses(
  language: LanguageCode,
  id: string,
  members: string[],
  actor: string,
) {
  if (new Set(members).size !== members.length || (members.length && !members.includes(id)))
    error(400, 'Select distinct uses including the active word');
  await db.transaction(async (tx) => {
    const base = await readEntry(language, id, tx);
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${'workshop:' + language}),hashtext(${base.draft.lemma}))`,
    );
    const rows = await tx.execute<{
      id: string;
      pos: string;
      entry: Source;
    }>(sql`SELECT l.id,l.pos,coalesce(h.entry,'{}'::jsonb) entry FROM lemmas l LEFT JOIN dictionary_entries h ON h.lemma_id=l.id
      WHERE l.language=${language} AND (NOT ${dictionaryProfile(language).requiresStoredEntry}::boolean OR h.lemma_id IS NOT NULL) AND l.headword=${base.draft.lemma} ORDER BY l.id FOR UPDATE OF l`);
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
        sql`INSERT INTO dictionary_entries(lemma_id,external_id,entry) VALUES(${row.id},${'parhiba:' + row.id},${JSON.stringify(entry)}::text::jsonb) ON CONFLICT(lemma_id) DO UPDATE SET entry=excluded.entry`,
      );
      await tx.insert(schema.lemmaEditHistory).values({
        lemmaId: row.id,
        editorId: actor,
        changeType: 'lemma_update',
        change: { before: row.entry, after: entry },
        reason: 'Group dictionary POS uses',
      });
    }
  });
}

type WorkshopTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function mergeWorkshopWords(
  language: LanguageCode,
  tx: WorkshopTransaction,
  id: string,
  target: string,
  actor: string,
  version?: string,
  spellingOnly = false,
) {
  if (id === target) error(400, 'Choose a different destination');
  await tx.execute(
    sql`SELECT id FROM lemmas WHERE language=${language} AND id IN (${id},${target}) ORDER BY id FOR UPDATE`,
  );
  const from = await readEntry(language, id, tx),
    to = await readEntry(language, target, tx);
  if (version && from.draft.version !== version)
    error(409, 'The source entry changed. Reopen it before merging.');
  if (from.entry.group_id) error(409, 'Ungroup the source POS use before merging.');
  const fromForms = await previewEntry(language, lexicalEntry(language, from.draft, from.entry));
  const profile = dictionaryProfile(language);
  const key = (s: string) =>
    profile.caseSensitive ? profile.normalize(s) : profile.normalize(s).toLowerCase();
  const excluded = new Set(to.draft.excluded.map(key));
  const accepted = Object.keys(fromForms.forms).filter((s) => !excluded.has(key(s)));
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
    ].filter((w) => w !== to.draft.lemma && !excluded.has(key(w))),
    workshop_excerpts: [...to.draft.excerpts, ...from.draft.excerpts],
    definitions: spellingOnly
      ? to.entry.definitions
      : [...(to.entry.definitions ?? []), ...(from.entry.definitions ?? [])],
  };
  await tx.execute(sql`INSERT INTO dictionary_entries (lemma_id,external_id,entry)
    VALUES (${target},${to.external},${JSON.stringify(entry)}::text::jsonb)
    ON CONFLICT (lemma_id) DO UPDATE SET entry=excluded.entry`);
  // Keep current scheduling and mined context together when both statuses exist.
  await tx.execute(sql`INSERT INTO user_known_lemmas(user_id,lemma_id,status,updated_at,mined_sentence,mined_chapter_id,mined_token_idx)
    SELECT user_id,${target},status,updated_at,mined_sentence,mined_chapter_id,mined_token_idx FROM user_known_lemmas WHERE lemma_id=${id}
    ON CONFLICT(user_id,lemma_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at,
      mined_sentence=coalesce(excluded.mined_sentence,user_known_lemmas.mined_sentence),
      mined_chapter_id=coalesce(excluded.mined_chapter_id,user_known_lemmas.mined_chapter_id),
      mined_token_idx=coalesce(excluded.mined_token_idx,user_known_lemmas.mined_token_idx)
    WHERE excluded.updated_at>user_known_lemmas.updated_at`);
  await tx.execute(sql`UPDATE user_languages ul SET known_words_count_cache=(SELECT count(*) FROM user_known_lemmas k JOIN lemmas l ON l.id=k.lemma_id
    WHERE k.user_id=ul.user_id AND k.status='known' AND l.language=${language} AND l.id<>${id})
    WHERE ul.language=${language} AND EXISTS(SELECT 1 FROM user_known_lemmas k WHERE k.user_id=ul.user_id AND k.lemma_id=${id})`);
  for (const record of spellingOnly ? [to] : [to, from]) {
    if (!record.draft.meaning) continue;
    await tx.execute(sql`INSERT INTO translations(target_type,target_id,target_language,source,body)
      SELECT 'lemma',${record.draft.id}::uuid,'en','curator',${record.draft.meaning} WHERE NOT EXISTS (
        SELECT 1 FROM translations WHERE target_type='lemma' AND target_id=${record.draft.id}
          AND target_language='en' AND source IN ('curator','official_dictionary') AND NOT hidden AND NOT is_private)`);
  }
  if (spellingOnly)
    await tx.execute(
      sql`UPDATE translations SET hidden=true WHERE target_id=${id} AND target_type='lemma' AND source IN ('official_dictionary','curator')`,
    );
  await tx.execute(
    sql`UPDATE translations SET target_id=${target} WHERE target_type='lemma' AND target_id=${id}`,
  );
  await tx.execute(sql`UPDATE lemma_forms SET lemma_id=${target} WHERE lemma_id=${id}
    AND (quarantined_at IS NOT NULL OR ${JSON.stringify(accepted)}::text::jsonb ? surface)`);
  await tx.execute(sql`INSERT INTO lemma_forms(lemma_id,surface,created_by) SELECT ${target},value,'curator'
    FROM jsonb_array_elements_text(${JSON.stringify(accepted)}::text::jsonb)
    WHERE NOT EXISTS(SELECT 1 FROM lemma_forms WHERE lemma_id=${target} AND surface=value AND quarantined_at IS NULL)`);
  await tx.execute(
    sql`UPDATE form_lemma_overrides SET chosen_lemma_id=${target} WHERE chosen_lemma_id=${id}`,
  );
  await tx.execute(
    sql`UPDATE token_corrections SET chosen_lemma_id=${target} WHERE chosen_lemma_id=${id}`,
  );
  await tx.execute(sql`UPDATE phrase_tokens SET lemma_id=${target} WHERE lemma_id=${id}`);
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
  await tx.insert(schema.lemmaEditHistory).values({
    lemmaId: target,
    editorId: actor,
    changeType: 'lemma_merge',
    change: {
      before: from.entry,
      after: entry,
      mergedFrom: { ...from.draft, externalId: from.external },
    },
    reason: 'Dictionary workshop',
  });
  await tx.execute(sql`DELETE FROM lemmas WHERE id=${id}`);
}
