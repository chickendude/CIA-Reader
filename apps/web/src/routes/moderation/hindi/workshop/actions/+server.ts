import { error, json, isHttpError } from '@sveltejs/kit';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { canEditDictionary } from '$lib/server/dictionary/permissions';
import {
  draftInput,
  getWorkshopWord,
  saveDraft,
  previewDraft,
  searchHindi,
  groupUses,
  mergeHindiWords,
} from '$lib/server/dictionary/hindi-workshop';
import { workshopQueue } from '$lib/server/dictionary/hindi-queue';
import { getHindiEntry } from '$lib/server/dictionary/hindidb';
import { deleteLemma } from '$lib/server/dictionary/curator';
import { nlpClient } from '$lib/server/nlp-client';
import { translateSentence } from '$lib/server/openai-client';
import type { RequestHandler } from './$types';

const id = z.string().uuid(),
  query = z.string().trim().max(400),
  limit = z.number().int().min(1).max(2000);
const input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('report'), report: query.min(1) }),
  z.object({
    action: z.literal('applyReport'),
    report: query.min(1),
    fingerprint: z.string().min(1),
    ids: z.array(id).min(1).max(3000),
  }),
  z.object({ action: z.literal('wiktionary'), query }),
  z.object({ action: z.literal('search'), query, limit }),
  z.object({ action: z.literal('word'), id }),
  z.object({ action: z.literal('save'), draft: draftInput }),
  z.object({ action: z.literal('preview'), draft: draftInput, inventory: z.boolean() }),
  z.object({ action: z.literal('group'), id, members: z.array(id).max(24) }),
  z.object({
    action: z.literal('queue'),
    book: id.nullable(),
    kind: z.enum(['', 'unresolved', 'missing-definition', 'ignored']),
    query,
    limit,
  }),
  z.object({ action: z.literal('ignore'), book: id, word: query.min(1), ignore: z.boolean() }),
  z.object({ action: z.literal('phrase'), phrase: query, verb: query, negative: z.boolean() }),
  z.object({ action: z.literal('delete'), id, version: z.string() }),
  z.object({ action: z.literal('merge'), id, target: id, version: z.string() }),
  z.object({
    action: z.literal('reference'),
    provider: z.enum(['hindwi', 'rekhta']).optional(),
    query: query.optional(),
    url: z.string().url().max(2048).optional(),
    refresh: z.boolean(),
  }),
  z.object({ action: z.literal('translate'), excerpt: z.string().trim().min(1).max(16000) }),
]);
export const POST: RequestHandler = async ({ request, locals }) => {
  const actor = locals.user;
  if (!actor || !(await canEditDictionary(actor, 'hi')))
    error(403, 'Hindi curator access required');
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) error(400, 'Invalid dictionary request');
  const p = parsed.data;
  try {
    switch (p.action) {
      case 'wiktionary': {
        const rows =
          await db.execute(sql`SELECT f.result->>'lemma' lemma,f.result->>'pos' pos,f.result->'definitions' definitions
          FROM hindi_reference_cache w CROSS JOIN LATERAL jsonb_array_elements_text(w.result) k
          JOIN hindi_reference_cache f ON f.key='foundation:'||k WHERE w.key=${'wiki:' + p.query.normalize('NFC')}`);
        return json([...rows]);
      }
      case 'report':
        return json(await nlpClient.hindiWorkshopReport(p.report));
      case 'applyReport': {
        const count = await db.transaction(async (tx) => {
          await tx.execute(
            sql`LOCK TABLE lemmas, translations, hindi_entries, lemma_forms IN SHARE ROW EXCLUSIVE MODE`,
          );
          const report = await nlpClient.hindiWorkshopReport(p.report);
          if (report.fingerprint !== p.fingerprint)
            error(409, 'The dictionary changed. Preview the report again.');
          const selected = new Set(p.ids);
          const eligible = report.rows.filter(
            (r) => r.id && selected.has(r.id) && r.state === 'ready',
          );
          if (eligible.length !== selected.size)
            error(400, 'Select eligible entries from the current report');
          for (const r of eligible) {
            if (p.report === 'spellings' && r.target)
              await mergeHindiWords(tx, r.id!, r.target, actor.id, undefined, true);
            else {
              await tx.execute(sql`INSERT INTO hindi_reference_cache(key,result)
                SELECT ${'applied:' + p.report + ':' + r.id},jsonb_build_object('entry',entry,'report',${p.report}::text,'editor',${actor.id}::text)
                FROM hindi_entries WHERE lemma_id=${r.id} ON CONFLICT (key) DO NOTHING`);
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
        return json(await searchHindi(p.query, p.limit));
      case 'word':
        return json(await getWorkshopWord(p.id));
      case 'save':
        return json(await getWorkshopWord(await saveDraft(p.draft, actor.id)));
      case 'preview':
        return json(await previewDraft(p.draft, p.inventory));
      case 'queue':
        return json(await workshopQueue(actor.id, p.book, p.kind, p.query, p.limit));
      case 'group':
        await groupUses(p.id, p.members, actor.id);
        return json(await getWorkshopWord(p.id));
      case 'ignore': {
        const [book] = await db.execute(
          sql`SELECT id FROM texts WHERE id=${p.book} AND language='hi' AND (owner_id=${actor.id} OR visibility='official')`,
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
      case 'phrase': {
        const [verb] = await db.execute<{ id: string }>(
          sql`SELECT id FROM lemmas WHERE language='hi' AND headword=${p.verb} AND pos IN ('VERB','AUX') ORDER BY pos DESC LIMIT 1`,
        );
        const word = verb && (await getHindiEntry(verb.id));
        if (!word) error(400, 'Select an existing Hindi verb');
        return json(
          await nlpClient.hindiWorkshopPreview(word.entry, {
            phrase: p.phrase,
            negative_variants: p.negative,
          }),
        );
      }
      case 'delete':
      case 'merge': {
        const source = await getWorkshopWord(p.id);
        if (source.draft.version !== p.version)
          error(409, 'This word changed. Reopen it before continuing.');
        if (p.action === 'delete') {
          await deleteLemma(actor, p.id);
          return json({ ok: true });
        }
        await getWorkshopWord(p.target);
        await db.transaction((tx) => mergeHindiWords(tx, p.id, p.target, actor.id, p.version));
        return json(await getWorkshopWord(p.target));
      }
      case 'translate':
        return json({ english: await translateSentence(p.excerpt, 'hi', 'en') });
      case 'reference': {
        const key = JSON.stringify([p.provider, p.query, p.url]);
        if (!p.refresh) {
          const [cached] = await db
            .select()
            .from(schema.hindiReferenceCache)
            .where(eq(schema.hindiReferenceCache.key, key));
          if (cached) return json(cached);
        }
        const result = await nlpClient.hindiReference(p);
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
    if (isHttpError(e)) throw e;
    if (e instanceof Error && e.message.startsWith('NLP service 400:')) {
      const detail = JSON.parse(e.message.slice('NLP service 400:'.length)).detail;
      error(400, typeof detail === 'string' ? detail : 'Invalid entry');
    }
    throw e;
  }
};
