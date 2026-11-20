import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { canEditDictionary } from '$lib/server/dictionary/permissions';
import {
  draftInputFor,
  getWorkshopWord,
  saveDraft,
  previewDraft,
  previewPhrase,
  searchWorkshop,
  groupUses,
  mergeWorkshopWords,
} from './workshop';
import { workshopQueue } from '$lib/server/dictionary/workshop-queue';
import { generateForms, listParadigmsForLemma, loadParadigm } from './paradigms';
import { deleteLemma } from '$lib/server/dictionary/curator';
import { HindiDictionaryError } from './hindi-runtime';
import { workshopAdapter, archiveKey } from './workshop-adapters';
import { translateSentence } from '$lib/server/openai-client';
import type { RequestEvent } from '@sveltejs/kit';
import type { LanguageCode } from '@ciareader/shared-types';
import { dictionaryProfile } from '$lib/dictionary/profiles';

const id = z.string().uuid(),
  query = z.string().trim().max(400),
  limit = z.number().int().min(1).max(2000);
const workshopInput = (language: LanguageCode) =>
  z.discriminatedUnion('action', [
    z.object({ action: z.literal('report'), report: query.min(1) }),
    z.object({
      action: z.literal('applyReport'),
      report: query.min(1),
      fingerprint: z.string().min(1),
      ids: z.array(id).min(1).max(3000),
    }),
    z.object({ action: z.literal('wiktionary'), query }),
    z.object({ action: z.literal('patterns'), pos: query.min(1) }),
    z.object({ action: z.literal('patternForms'), id, stem: query.min(1), pos: query.min(1) }),
    z.object({
      action: z.literal('search'),
      query,
      limit,
      offset: z.number().int().nonnegative().default(0),
    }),
    z.object({ action: z.literal('word'), id }),
    z.object({ action: z.literal('save'), draft: draftInputFor(language) }),
    z.object({
      action: z.literal('preview'),
      draft: draftInputFor(language),
      inventory: z.boolean(),
    }),
    z.object({ action: z.literal('group'), id, members: z.array(id).max(24) }),
    z.object({
      action: z.literal('queue'),
      offset: z.number().int().nonnegative().default(0),
      book: id.nullable(),
      kind: z.enum(['', 'unresolved', 'missing-definition', 'ignored', 'stutter']),
      query,
      limit,
    }),
    z.object({
      action: z.literal('stutter'),
      chapter: id,
      start: z.number().int().nonnegative(),
      surface: z.string().min(1),
      hash: z.string().length(64),
      confirm: z.boolean(),
    }),
    z.object({ action: z.literal('ignore'), book: id, word: query.min(1), ignore: z.boolean() }),
    z.object({ action: z.literal('phrase'), phrase: query, verb: query, negative: z.boolean() }),
    z.object({ action: z.literal('delete'), id, version: z.string() }),
    z.object({ action: z.literal('merge'), id, target: id, version: z.string() }),
    z.object({
      action: z.literal('reference'),
      provider: query.optional(),
      query: query.optional(),
      url: z.string().url().max(2048).optional(),
      refresh: z.boolean(),
    }),
    z.object({ action: z.literal('translate'), excerpt: z.string().trim().min(1).max(16000) }),
  ]);
export async function workshopAction(language: LanguageCode, { request, locals }: RequestEvent) {
  const actor = locals.user;
  if (!actor || !(await canEditDictionary(actor, language)))
    error(403, 'Dictionary curator access required for this language');
  const parsed = workshopInput(language).safeParse(await request.json().catch(() => null));
  if (!parsed.success) error(400, 'Invalid dictionary request');
  const p = parsed.data;
  const adapter = workshopAdapter(language);
  try {
    switch (p.action) {
      case 'patterns': {
        const patterns = await listParadigmsForLemma(language, p.pos);
        return json(patterns.map(({ id, name }) => ({ id, label: name })));
      }
      case 'patternForms': {
        const saved = await loadParadigm(p.id);
        if (!saved || saved.paradigm.language !== language || saved.paradigm.pos !== p.pos)
          error(404, 'Pattern not found for this language and part of speech');
        return json(generateForms(saved.slots, p.stem).map((form) => form.surface));
      }
      case 'wiktionary': {
        const rows =
          await db.execute(sql`SELECT f.result->>'lemma' lemma,f.result->>'pos' pos,f.result->'definitions' definitions
          FROM hindi_reference_cache w CROSS JOIN LATERAL jsonb_array_elements_text(w.result) k
          JOIN hindi_reference_cache f ON f.key=${archiveKey(language, 'foundation:')}||k
          WHERE w.key=${archiveKey(language, 'wiki:' + p.query.normalize('NFC'))}`);
        if (!rows.length) {
          const imported = await db.execute(sql`SELECT l.headword lemma,l.pos,
            jsonb_agg(jsonb_build_object('original',t.body,'language',t.target_language)
              ORDER BY t.display_rank NULLS LAST,t.id) definitions
            FROM lemmas l JOIN translations t ON t.target_type='lemma' AND t.target_id=l.id
            WHERE l.language=${language} AND l.headword=${p.query.normalize('NFC')}
              AND t.source_id LIKE ${'kaikki:' + language + ':%'} AND NOT t.hidden AND NOT t.is_private
            GROUP BY l.id ORDER BY l.pos,l.id`);
          return json([...imported]);
        }
        return json([...rows]);
      }
      case 'report':
        if (!adapter.report) error(400, 'No report provider for this dictionary');
        return json(await adapter.report(p.report));
      case 'applyReport': {
        const reportFor = adapter.report;
        if (!reportFor) error(400, 'No report provider for this dictionary');
        const option = (await adapter.listReports?.())?.find((r) => r.name === p.report);
        if (!option) error(404, 'Report not found for this dictionary');
        const count = await db.transaction(async (tx) => {
          await tx.execute(
            sql`LOCK TABLE lemmas, translations, dictionary_entries, lemma_forms IN SHARE ROW EXCLUSIVE MODE`,
          );
          const report = await reportFor(p.report);
          if (report.fingerprint !== p.fingerprint)
            error(409, 'The dictionary changed. Preview the report again.');
          const selected = new Set(p.ids);
          const eligible = report.rows.filter(
            (r) => r.id && selected.has(r.id) && r.state === 'ready',
          );
          if (eligible.length !== selected.size)
            error(400, 'Select eligible entries from the current report');
          for (const r of eligible) {
            if (option.action === 'merge') {
              if (!r.target) error(409, 'The merge needs a destination');
              await mergeWorkshopWords(language, tx, r.id!, r.target, actor.id, undefined, true);
            } else {
              const [source] = await tx.execute(
                sql`SELECT id FROM lemmas WHERE id=${r.id} AND language=${language} FOR UPDATE`,
              );
              if (!source) error(409, 'The report entry is no longer in this dictionary');
              await tx.execute(sql`INSERT INTO hindi_reference_cache(key,result)
                SELECT ${archiveKey(language, 'applied:' + p.report + ':' + r.id)},jsonb_build_object('entry',entry,'report',${p.report}::text,'editor',${actor.id}::text)
                FROM dictionary_entries WHERE lemma_id=${r.id} ON CONFLICT (key) DO NOTHING`);
              await tx.execute(
                sql`DELETE FROM translations WHERE target_type='lemma' AND target_id=${r.id}`,
              );
              await tx.execute(sql`DELETE FROM lemmas WHERE id=${r.id}`);
            }
          }
          return eligible.length;
        });
        return json({ count });
      }
      case 'search':
        return json(await searchWorkshop(language, p.query, p.limit, p.offset));
      case 'word':
        return json(await getWorkshopWord(p.id, language));
      case 'save':
        return json(await getWorkshopWord(await saveDraft(p.draft, actor.id, language), language));
      case 'preview':
        return json(await previewDraft(language, p.draft, p.inventory));
      case 'queue':
        return json(
          await workshopQueue(actor.id, p.book, p.kind, p.query, p.limit, p.offset, language),
        );
      case 'group':
        await groupUses(language, p.id, p.members, actor.id);
        return json(await getWorkshopWord(p.id, language));
      case 'stutter':
        if (!adapter.reviewStutter) error(400, 'No stutter analysis for this dictionary');
        await adapter.reviewStutter(actor.id, p.chapter, p.start, p.surface, p.hash, p.confirm);
        return json({ ok: true });
      case 'ignore': {
        const [book] = await db.execute(
          sql`SELECT id FROM texts WHERE id=${p.book} AND language=${language} AND (owner_id=${actor.id} OR visibility='official')`,
        );
        if (!book) error(404, 'Book not found');
        if (p.ignore)
          await db
            .insert(schema.hindiReviewIgnored)
            .values({ textId: p.book, surface: p.word })
            .onConflictDoNothing();
        else
          await db.execute(
            sql`DELETE FROM hindi_review_ignored WHERE text_id=${p.book} AND surface=${p.word}`,
          );
        return json({ ok: true });
      }
      case 'phrase':
        return json(await previewPhrase(language, p.phrase, p.verb, p.negative));
      case 'delete':
      case 'merge': {
        const source = await getWorkshopWord(p.id, language);
        if (source.draft.version !== p.version)
          error(409, 'This word changed. Reopen it before continuing.');
        if (p.action === 'delete') {
          await deleteLemma(actor, p.id);
          return json({ ok: true });
        }
        await getWorkshopWord(p.target, language);
        await db.transaction((tx) =>
          mergeWorkshopWords(language, tx, p.id, p.target, actor.id, p.version),
        );
        return json(await getWorkshopWord(p.target, language));
      }
      case 'translate':
        return json({ english: await translateSentence(p.excerpt, language, 'en') });
      case 'reference': {
        if (
          !adapter.reference ||
          (p.provider && !dictionaryProfile(language).sources.some((s) => s.id === p.provider))
        )
          error(400, 'Choose a source configured for this dictionary');
        const key = archiveKey(language, JSON.stringify([p.provider, p.query, p.url]));
        if (!p.refresh) {
          const [cached] = await db
            .select()
            .from(schema.hindiReferenceCache)
            .where(eq(schema.hindiReferenceCache.key, key));
          if (cached) return json(cached);
        }
        const result = await adapter.reference(p);
        const retrievedAt = new Date();
        await db
          .insert(schema.hindiReferenceCache)
          .values({ key, result, retrievedAt })
          .onConflictDoUpdate({
            target: schema.hindiReferenceCache.key,
            set: { result, retrievedAt },
          });
        return json({ result, retrievedAt });
      }
    }
  } catch (e) {
    if (e instanceof HindiDictionaryError) error(e.status, e.message);
    throw e;
  }
}
