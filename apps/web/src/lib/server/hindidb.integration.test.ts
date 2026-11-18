// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import type { DB } from './db/index.js';
import * as schema from './db/schema.js';

const state = vi.hoisted(() => ({ db: undefined as unknown as DB }));
vi.mock('./db/index.js', async () => ({
  get db() {
    return state.db;
  },
  schema: await import('./db/schema.js'),
}));

const url = process.env.HINDIDB_TEST_DATABASE_URL;
describe.skipIf(!url)('HindiDB PostgreSQL integration (always rolls back)', () => {
  it('counts all alternatives, preserves unresolved gaps, and refreshes coverage with study state', async () => {
    if (!url || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)) {
      throw new Error('Use a local database with the HindiDB migrations and import applied');
    }
    const client = postgres(url, { max: 1 });
    const database = drizzle(client, { schema });
    const rollback = new Error('rollback fixture');
    try {
      await expect(
        database.transaction(async (tx) => {
          state.db = tx as unknown as DB;
          const { listTextStats, listCollectionStats } = await import('./learning-stats.js');
          const { persistHindiTokens } = await import('./texts/hindidb.js');
          const { lemmaBookFrequency } = await import('./texts/book-frequency.js');
          const [user] = await tx
            .insert(schema.users)
            .values({ email: `${randomUUID()}@example.invalid` })
            .returning();
          const [text] = await tx
            .insert(schema.texts)
            .values({ ownerId: user!.id, language: 'hi', title: 'Test', sourceType: 'paste' })
            .returning();
          const [chapter] = await tx
            .insert(schema.textChapters)
            .values({ textId: text!.id, idx: 0, body: 'खाना अज्ञात' })
            .returning();
          const [collection] = await tx
            .insert(schema.collections)
            .values({ ownerId: user!.id, language: 'hi', title: 'Test book' })
            .returning();
          await tx
            .insert(schema.collectionItems)
            .values({ collectionId: collection!.id, textId: text!.id, position: 0 });
          const headword = `परीक्षण${randomUUID()}`;
          const entries = await tx
            .insert(schema.lemmas)
            .values(
              ['NOUN', 'VERB'].map((pos) => ({
                language: 'hi' as const,
                script: 'Deva',
                source: 'curator' as const,
                headword,
                pos,
              })),
            )
            .returning();
          const revision = (await tx.select().from(schema.hindiDictionaryState))[0]!.revision;
          await persistHindiTokens(
            chapter!.id,
            [
              {
                idx: 0,
                surface: 'खाना',
                is_word: true,
                is_oov: false,
                is_ambiguous: true,
                romanization: null,
                number_forms: null,
                candidates: entries.map((e) => ({
                  lemma: e.headword,
                  pos: e.pos,
                  dictionary_id: e.id,
                  score: 1,
                  features: {},
                })),
              },
            ],
            {
              revision,
              parser_version: 'test',
              stats: { source_words: 2, unresolved_occurrences: 1 },
              occurrences: entries.map((e) => ({
                start_idx: 0,
                end_idx: 1,
                lemma_id: e.id,
                source_start: 0,
                source_end: 4,
                rules: ['explicit-form'],
              })),
            },
          );
          await tx.insert(schema.userKnownLemmas).values([
            { userId: user!.id, lemmaId: entries[0]!.id, status: 'known' },
            { userId: user!.id, lemmaId: entries[1]!.id, status: 'learning' },
          ]);
          const { loadHindiContextChoices } = await import('./texts/hindi-context.js');
          const { loadChapterTokens } = await import('./texts/tokens.js');
          await tx.insert(schema.hindiContextChoices).values({
            chapterId: chapter!.id, sourceOccurrenceId: 'source-word', sourceStart: 0, sourceEnd: 4,
            selectedLemmaIds: [entries[1]!.id], candidateLemmaIds: entries.map((e) => e.id),
            origin: 'ai', status: 'ai_suggested',
            metadata: { chapter_hash: createHash('md5').update(chapter!.body).digest('hex') },
          });
          expect((await loadHindiContextChoices(chapter!.id)).get(0)).toMatchObject({
            selectedLemmaIds: [entries[1]!.id], status: 'ai_suggested',
          });
          const [selectedToken] = (await loadChapterTokens(chapter!.id, user!.id))!;
          expect(selectedToken).toMatchObject({ lemmaId: entries[1]!.id, selectedBy: 'ai' });
          expect(selectedToken!.candidates.map((c) => c.lemmaId)).toContain(entries[0]!.id);
          const { saveHindiContextChoice } = await import('./texts/hindi-context.js');
          await saveHindiContextChoice(selectedToken!.id,[entries[1]!.id],selectedToken!.contextVersion!,user!);
          const [confirmed] = (await loadChapterTokens(chapter!.id,user!.id))!;
          expect(confirmed!.selectedBy).toBe('human');
          await expect(saveHindiContextChoice(confirmed!.id,[entries[0]!.id],confirmed!.contextVersion!,{...user!,role:'admin'},
            {model:'test',reason:'test',outcome:'selected'})).rejects.toMatchObject({status:409});
          await expect(saveHindiContextChoice(selectedToken!.id,[entries[0]!.id],selectedToken!.contextVersion!,user!))
            .rejects.toMatchObject({status:409});
          await saveHindiContextChoice(confirmed!.id,[],confirmed!.contextVersion!,user!);
          const [cleared] = (await loadChapterTokens(chapter!.id,user!.id))!;
          expect(cleared!.selectedBy).toBeUndefined();
          await saveHindiContextChoice(cleared!.id,[entries[1]!.id],cleared!.contextVersion!,user!);
          const choicesAfterReview=await tx.select().from(schema.hindiContextChoices).where(eq(schema.hindiContextChoices.chapterId,chapter!.id));
          expect(choicesAfterReview[0]!.metadata.context_reviews).toHaveLength(3);
          await tx.update(schema.textChapters).set({ body: 'changed passage' }).where(eq(schema.textChapters.id, chapter!.id));
          expect((await loadHindiContextChoices(chapter!.id)).get(0)).toMatchObject({
            selectedLemmaIds: [], status: 'needs_review',
          });
          await tx.update(schema.textChapters).set({ body: chapter!.body }).where(eq(schema.textChapters.id, chapter!.id));
          const [stats] = await listTextStats(user!.id, 'hi');
          expect(stats).toMatchObject({
            totalWords: 2,
            uniqueLemmas: 2,
            unresolvedWords: 1,
            estimatedComprehensionPct: 33,
            learningCoveragePct: 67,
            uniqueKnownPct: 50,
            analysisStale: false,
          });
          expect((await listCollectionStats(user!.id, 'hi'))[0]).toMatchObject({
            totalWords: 2,
            uniqueLemmas: 2,
            estimatedComprehensionPct: 33,
            learningCoveragePct: 67,
          });
          expect(await lemmaBookFrequency(text!.id, entries[1]!.id)).toEqual({ book: 1, text: 1 });
          await tx
            .update(schema.userKnownLemmas)
            .set({ status: 'known' })
            .where(eq(schema.userKnownLemmas.userId, user!.id));
          expect((await listTextStats(user!.id, 'hi'))[0]!.estimatedComprehensionPct).toBe(67);
          await tx
            .update(schema.lemmas)
            .set({ glossDefault: 'meaning edit' })
            .where(eq(schema.lemmas.id, entries[0]!.id));
          expect((await listTextStats(user!.id, 'hi'))[0]!.analysisStale).toBe(false);
          const [definition] = await tx
            .insert(schema.translations)
            .values({
              targetType: 'lemma',
              targetId: entries[0]!.id,
              source: 'curator',
              body: 'original',
              targetLanguage: 'en',
            })
            .returning();
          const { updateTranslation } = await import('./dictionary/curator.js');
          await updateTranslation(
            { id: user!.id, role: 'admin' },
            definition!.id,
            { body: 'revised meaning; another meaning' },
            'Integration test',
          );
          const [edited] = await tx
            .select()
            .from(schema.lemmas)
            .where(eq(schema.lemmas.id, entries[0]!.id));
          expect(edited!.glossDefault).toBe('revised meaning; another meaning');
          expect((await loadHindiContextChoices(chapter!.id)).get(0)?.selectedLemmaIds).toEqual([entries[1]!.id]);
          // Catalog visibility never grants access to the full source text.
          const { canReadText, canReadChapter } = await import('./auth/can-read.js');
          const { getOfficialBook, getOfficialBookCards, importOfficialBook } = await import('./texts/official.js');
          const { getAnkiCards } = await import('./anki.js');
          const [official] = await tx.update(schema.texts).set({ visibility: 'official', staffOnly: true, status: 'ready' })
            .where(eq(schema.texts.id, text!.id)).returning();
          expect(await canReadText(null, official!)).toBe(false);
          expect(await canReadText(user!, official!)).toBe(false);
          expect(await canReadChapter(user!, chapter!.id)).toBe(false);
          expect((await getAnkiCards(user!.id, { textId: text!.id })).cards).toEqual([]);
          await expect(importOfficialBook(text!.id, user!.id)).rejects.toMatchObject({ status: 403 });
          const media = await getOfficialBook(text!.id, user!.id);
          expect(media).toMatchObject({ words: 2, uniqueWords: 2, unresolved: 1, knownPct: 66.7, personalTextId:text!.id });
          expect(JSON.stringify(media)).not.toContain(chapter!.body);
          const cards = await getOfficialBookCards(text!.id, user!.id, 'all');
          expect(cards).toHaveLength(2);
          expect(cards.every(c => c.samples.length === 0 && c.minedSentence === null && c.frequency === 1)).toBe(true);
          expect(await getOfficialBookCards(text!.id, user!.id, 'unknown')).toEqual([]);
          for (const role of ['curator','admin'] as const) {
            await tx.update(schema.users).set({ role }).where(eq(schema.users.id, user!.id));
            expect(await canReadText(user!, official!)).toBe(true);
          }
          const copyId = await importOfficialBook(text!.id, user!.id);
          expect(copyId).toBe(text!.id);
          expect(await importOfficialBook(text!.id, user!.id)).toBe(copyId);
          const [copyChapter] = await tx.select().from(schema.textChapters).where(eq(schema.textChapters.textId, copyId));
          expect(copyChapter!.body).toBe(chapter!.body);
          expect((await loadHindiContextChoices(copyChapter!.id)).get(0)?.selectedLemmaIds).toEqual([entries[1]!.id]);
          await tx.update(schema.users).set({ role: 'user' }).where(eq(schema.users.id, user!.id));
          expect(await canReadChapter(user!, copyChapter!.id)).toBe(false);
          expect((await listTextStats(user!.id, 'hi'))[0]!.analysisStale).toBe(false);
          await expect(
            updateTranslation(
              { id: user!.id, role: 'user' },
              definition!.id,
              { body: 'not permitted' },
              'Integration test',
            ),
          ).rejects.toThrow('curator rights');
          await tx
            .insert(schema.lemmaForms)
            .values({ lemmaId: entries[0]!.id, surface: 'परीक्षणों', createdBy: 'curator' });
          expect((await listTextStats(user!.id, 'hi'))[0]!.analysisStale).toBe(true);
          const { workshopQueue } = await import('./dictionary/hindi-queue.js');
          const [secondBook] = await tx.insert(schema.texts).values({
            ownerId: user!.id, language: 'hi', title: 'Second review book', sourceType: 'paste',
          }).returning();
          const missing = 'अपरिचित' + randomUUID();
          const [secondChapter] = await tx.insert(schema.textChapters).values({
            textId: secondBook!.id, idx: 0, body: missing,
          }).returning();
          await tx.insert(schema.textTokens).values([
            { chapterId: chapter!.id, idx: 1, surface: missing, isOov: true },
            { chapterId: chapter!.id, idx: 2, surface: missing, isOov: true },
            { chapterId: secondChapter!.id, idx: 0, surface: missing, isOov: true },
            { chapterId: secondChapter!.id, idx: 1, surface: missing + 'अ', isOov: true },
          ]);
          const firstPage = await workshopQueue(user!.id, null, 'unresolved', missing, 1);
          expect(firstPage.total).toBe(2);
          expect(firstPage.rows[0]).toMatchObject({
            word: missing, count: 3, samples: [
              { book: text!.id, count: 2, token: 1, context: { before: 'खाना', match: missing, after: missing } },
              { book: secondBook!.id, count: 1, token: 0, context: { before: '', match: missing, after: missing + 'अ' } },
            ],
          });
          expect((await workshopQueue(user!.id, null, 'unresolved', missing, 1, 1)).rows[0]?.word)
            .toBe(missing + 'अ');
          await tx.insert(schema.hindiReviewIgnored).values({ textId: secondBook!.id, surface: missing });
          expect((await workshopQueue(user!.id, null, 'unresolved', missing, 1)).rows[0]?.count).toBe(2);
          expect((await workshopQueue(user!.id, secondBook!.id, 'ignored', missing, 1)).rows[0]?.count).toBe(1);
          expect((await workshopQueue(randomUUID(), secondBook!.id, '', missing, 10)).rows).toEqual([]);
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    } finally {
      await client.end();
    }
  });
});
