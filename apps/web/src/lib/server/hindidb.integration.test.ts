// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';
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
  it('matches headword prefixes and the start of any English definition word in both dictionary views', async () => {
    if (!url || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)) {
      throw new Error('Use a local database with the HindiDB migrations applied');
    }
    const client = postgres(url, { max: 1 });
    const rollback = new Error('rollback dictionary search fixture');
    try {
      await expect(drizzle(client, { schema }).transaction(async (tx) => {
        state.db = tx as unknown as DB;
        const { listDictionaryLemmas } = await import('./dictionary/browse.js');
        const { searchWorkshop } = await import('./dictionary/workshop.js');
        const marker = randomUUID() + '.';
        const words = [
          { headword: marker + 'application', glossDefault: '' },
          { headword: marker + 'fruit', glossDefault: 'a ripe ' + marker + 'Apple' },
          { headword: marker + 'tree', glossDefault: 'fruit (' + marker + 'apple tree)' },
          { headword: marker + 'decoy', glossDefault: marker.replace('.', 'x') + 'apple' },
          { headword: 'pine' + marker + 'apple', glossDefault: 'pine' + marker + 'apple' },
        ];
        await tx.insert(schema.lemmas).values(words.map((word) => ({
          ...word, language: 'eu' as const, script: 'Latn', pos: 'NOUN', source: 'curator' as const,
        })));
        const query = marker + 'appl';
        const expected = [marker + 'application', marker + 'fruit', marker + 'tree'];
        const publicMatches = await listDictionaryLemmas('eu', { q: query, matchEntryText: true });
        expect(publicMatches.lemmas.map((row) => row.headword).sort()).toEqual(expected);
        expect((await searchWorkshop('eu', query, 10)).map((row) => row.lemma).sort()).toEqual(expected);
        throw rollback;
      })).rejects.toBe(rollback);
    } finally {
      await client.end();
    }
  });

  it('counts each occurrence once and follows valid context choices and study state', async () => {
    if (!url || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)) {
      throw new Error('Use a local database with the HindiDB migrations applied');
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
          await tx.insert(schema.hindiDictionaryState).values({ id: 1 }).onConflictDoNothing();
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
          // Exercise the deferred frequency refresh inside this rollback-only fixture.
          await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
          const counts = () => tx.execute(sql`SELECT lemma_id, occurrences FROM book_word_frequencies
            WHERE text_id=${text!.id} ORDER BY lemma_id NULLS LAST`);
          expect(Array.from(await counts())).toEqual([{ lemma_id: null, occurrences: 2 }]);
          const { libraryBookStats } = await import('./texts/book-stats.js');
          const unmatched = await libraryBookStats([text!.id], [collection!.id]);
          for (const id of [text!.id, collection!.id]) {
            expect(unmatched[id]).toMatchObject({ words: 2, unresolved: 2, unparsedWords: 1 });
          }
          await tx.insert(schema.userKnownLemmas).values([
            { userId: user!.id, lemmaId: entries[0]!.id, status: 'known' },
            { userId: user!.id, lemmaId: entries[1]!.id, status: 'learning' },
          ]);
          const { loadHindiContextChoices } = await import('./texts/hindi-context.js');
          const { loadChapterTokens } = await import('./texts/tokens.js');
          const { reviewPage } = await import('./texts/hindi-review.js');
          const attention = (status: 'attention' | 'ai_suggested' | 'confirmed' = 'attention') =>
            reviewPage(text!.id, { ...user!, role: 'admin' }, 0, '', status);
          // An imported review can remember two spellings even if only one entry survived.
          const [removed] = await tx.delete(schema.hindiOccurrences)
            .where(eq(schema.hindiOccurrences.lemmaId, entries[1]!.id)).returning();
          await tx.insert(schema.hindiContextChoices).values({
            chapterId: chapter!.id, sourceOccurrenceId: 'old-spellings', sourceStart: 0, sourceEnd: 4,
            selectedLemmaIds: [], candidateLemmaIds: [entries[0]!.id], origin: 'ai', status: 'needs_review',
            metadata: {
              chapter_hash: createHash('md5').update(chapter!.body).digest('hex'),
              candidate_snapshot: entries.map(e => ({ id: e.id })), outcome: 'uncertain',
              surface: 'खाना', current_surface: 'खाना', sentence_text: chapter!.body, current_sentence: chapter!.body,
            },
          });
          expect((await loadHindiContextChoices(chapter!.id)).has(0)).toBe(false);
          expect(await attention()).toMatchObject({ total: 0, occurrences: [] });
          await tx.insert(schema.hindiOccurrences).values(removed!);
          expect((await loadHindiContextChoices(chapter!.id)).get(0)?.status).toBe('needs_review');
          expect(await attention()).toMatchObject({ total: 1, attentionCounts: { needs_review: 1 } });
          await tx.delete(schema.hindiContextChoices).where(eq(schema.hindiContextChoices.chapterId, chapter!.id));
          await tx.insert(schema.hindiContextChoices).values({
            chapterId: chapter!.id, sourceOccurrenceId: 'source-word', sourceStart: 0, sourceEnd: 4,
            selectedLemmaIds: [entries[1]!.id], candidateLemmaIds: entries.map((e) => e.id),
            origin: 'ai', status: 'ai_suggested',
            metadata: { chapter_hash: createHash('md5').update(chapter!.body).digest('hex') },
          });
          expect((await loadHindiContextChoices(chapter!.id)).get(0)).toMatchObject({
            selectedLemmaIds: [entries[1]!.id], status: 'ai_suggested',
          });
          const [selectedToken] = (await loadChapterTokens(chapter!.id, user!.id, text!.id))!;
          expect(selectedToken).toMatchObject({ lemmaId: entries[1]!.id, selectedBy: 'ai', bookFrequency: 1 });
          expect(selectedToken!.candidates.map((c) => c.lemmaId)).toContain(entries[0]!.id);
          expect(await attention()).toMatchObject({ total: 0, occurrences: [], attentionCounts: { attention: 0, ai_suggested: 1 } });
          expect(await attention('ai_suggested')).toMatchObject({ total: 1, occurrences: [{ status: 'ai_suggested' }] });
          const { saveHindiContextChoice } = await import('./texts/hindi-context.js');
          await saveHindiContextChoice(selectedToken!.id,[entries[1]!.id],selectedToken!.contextVersion!,user!);
          const [confirmed] = (await loadChapterTokens(chapter!.id,user!.id))!;
          expect(confirmed!.selectedBy).toBe('human');
          expect(await attention('confirmed')).toMatchObject({
            total: 1, occurrences: [{ status: 'confirmed' }], attentionCounts: { attention: 0, confirmed: 1 },
          });
          expect(await attention('ai_suggested')).toMatchObject({ total: 0, occurrences: [] });
          await expect(saveHindiContextChoice(confirmed!.id,[entries[0]!.id],confirmed!.contextVersion!,{...user!,role:'admin'},
            {model:'test',reason:'test',outcome:'selected'})).rejects.toMatchObject({status:409});
          await expect(saveHindiContextChoice(selectedToken!.id,[entries[0]!.id],selectedToken!.contextVersion!,user!))
            .rejects.toMatchObject({status:409});
          await saveHindiContextChoice(confirmed!.id,[],confirmed!.contextVersion!,user!);
          const [cleared] = (await loadChapterTokens(chapter!.id,user!.id))!;
          expect(cleared!.selectedBy).toBeUndefined();
          expect(await attention()).toMatchObject({
            total: 1, attentionCounts: { unconfirmed: 1 },
            occurrences: [{ surface: 'खाना', status: 'unconfirmed' }],
          });
          await saveHindiContextChoice(cleared!.id,[entries[1]!.id],cleared!.contextVersion!,user!);
          const choicesAfterReview=await tx.select().from(schema.hindiContextChoices).where(eq(schema.hindiContextChoices.chapterId,chapter!.id));
          expect(choicesAfterReview[0]!.metadata.context_reviews).toHaveLength(3);
          await tx.update(schema.textChapters).set({ body: 'changed passage' }).where(eq(schema.textChapters.id, chapter!.id));
          expect(Array.from(await counts())).toEqual([{ lemma_id: null, occurrences: 2 }]);
          expect((await loadHindiContextChoices(chapter!.id)).get(0)).toMatchObject({
            selectedLemmaIds: [], status: 'needs_review',
          });
          expect(await attention()).toMatchObject({ total: 1, attentionCounts: { needs_review: 1 } });
          await tx.update(schema.textChapters).set({ body: chapter!.body }).where(eq(schema.textChapters.id, chapter!.id));
          const { getAnkiCards } = await import('./anki.js');
          const exportIds = async (includeStudied = false) =>
            (await getAnkiCards(user!.id, { textId: text!.id, includeStudied })).cards.map(card => card.id);
          expect(await exportIds()).toEqual([]);
          expect(await exportIds(true)).toEqual([entries[1]!.id]);
          const [stats] = await listTextStats(user!.id, 'hi');
          expect(stats).toMatchObject({
            totalWords: 2,
            uniqueLemmas: 1,
            unresolvedWords: 1,
            estimatedComprehensionPct: 0,
            learningCoveragePct: 50,
            uniqueKnownPct: 0,
            analysisStale: false,
          });
          expect((await listCollectionStats(user!.id, 'hi'))[0]).toMatchObject({
            totalWords: 2,
            uniqueLemmas: 1,
            estimatedComprehensionPct: 0,
            learningCoveragePct: 50,
          });
          expect(await lemmaBookFrequency(text!.id, entries[1]!.id)).toEqual({ book: 1, text: 1 });
          await tx.delete(schema.userKnownLemmas).where(eq(schema.userKnownLemmas.lemmaId, entries[1]!.id));
          expect(await exportIds()).toEqual([entries[1]!.id]);
          await tx.insert(schema.userKnownLemmas).values({
            userId: user!.id, lemmaId: entries[1]!.id, status: 'ignored',
          });
          expect(await exportIds(true)).toEqual([]);
          await tx
            .update(schema.userKnownLemmas)
            .set({ status: 'known' })
            .where(eq(schema.userKnownLemmas.userId, user!.id));
          expect(await exportIds()).toEqual([]);
          expect(await exportIds(true)).toEqual([entries[1]!.id]);
          expect((await listTextStats(user!.id, 'hi'))[0]!.estimatedComprehensionPct).toBe(50);
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
          const [official] = await tx.update(schema.texts).set({ visibility: 'official', staffOnly: true, status: 'ready' })
            .where(eq(schema.texts.id, text!.id)).returning();
          expect(await canReadText(null, official!)).toBe(false);
          expect(await canReadText(user!, official!)).toBe(false);
          expect(await canReadChapter(user!, chapter!.id)).toBe(false);
          expect((await getAnkiCards(user!.id, { textId: text!.id })).cards).toEqual([]);
          await expect(importOfficialBook(text!.id, user!.id)).rejects.toMatchObject({ status: 403 });
          const media = await getOfficialBook(text!.id, user!.id);
          expect(media).toMatchObject({ words: 2, uniqueWords: 1, unresolved: 1, knownPct: 50, personalTextId:text!.id });
          expect(JSON.stringify(media)).not.toContain(chapter!.body);
          const { cachedBookScores, ensureReaderCoverage, refreshReaderCoverage } = await import('./texts/reader-coverage.js');
          await tx.update(schema.collections).set({ visibility: 'official' }).where(eq(schema.collections.id,collection!.id));
          const score = () => tx.execute(sql`SELECT round(100*reading_ratio)::int AS pct FROM
            (${cachedBookScores(user!.id)}) s WHERE id=${collection!.id}`);
          await ensureReaderCoverage(user!.id);
          expect(Array.from(await score())).toEqual([{ pct: 50 }]);
          await tx.update(schema.userKnownLemmas).set({ status: 'learning' }).where(eq(schema.userKnownLemmas.userId,user!.id));
          expect(Array.from(await score())).toEqual([{ pct: 50 }]);
          await ensureReaderCoverage(user!.id);
          await refreshReaderCoverage(user!.id);
          expect(Array.from(await score())).toEqual([{ pct: 0 }]);
          await tx.update(schema.userKnownLemmas).set({ status: 'known' }).where(eq(schema.userKnownLemmas.userId,user!.id));
          await refreshReaderCoverage(user!.id);
          const [other] = await tx.insert(schema.users).values({ email: `${randomUUID()}@example.invalid` }).returning();
          await ensureReaderCoverage(other!.id);
          const [isolation] = await tx.execute(sql`SELECT catalog_revision=(SELECT catalog_revision FROM reader_coverage_cache
            WHERE user_id=${user!.id}) AS shared, (SELECT bool_and(n=0) FROM unnest(known_words) n) AS zero
            FROM reader_coverage_cache WHERE user_id=${other!.id}`);
          expect(isolation).toEqual({ shared: true, zero: true });
          await tx.update(schema.textChapters).set({ body: 'changed again' }).where(eq(schema.textChapters.id,chapter!.id));
          await refreshReaderCoverage(user!.id);
          expect(Array.from(await score())).toEqual([{ pct: 0 }]);
          await tx.update(schema.textChapters).set({ body: chapter!.body }).where(eq(schema.textChapters.id,chapter!.id));

          const cards = await getOfficialBookCards(text!.id, user!.id, 'all');
          expect(cards.map(c => c.id)).toEqual([entries[1]!.id]);
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
          const { workshopQueue } = await import('./dictionary/workshop-queue.js');
          const [secondBook] = await tx.insert(schema.texts).values({
            ownerId: user!.id, language: 'hi', title: 'Second review book', sourceType: 'paste',
          }).returning();
          const suffix = Array.from(randomUUID().slice(0, 8), (c) => 'कखगघचछजझटठडढतथदध'[parseInt(c, 16)]).join('');
          const missing = 'अपरिचित' + suffix;
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
          const { saveDraft } = await import('./dictionary/workshop.js');
          const { emptyDraft } = await import('$lib/dictionary/workshop');
          const savedId = await saveDraft({
            ...emptyDraft('परीक्षण' + suffix), meaning: 'test word', other: [missing],
          }, user!.id, 'hi');
          const reopened = await loadChapterTokens(chapter!.id, user!.id);
          expect(reopened?.filter((t) => t.surface === missing).map((t) => t.lemmaId))
            .toEqual([savedId, savedId]);
          const legacy = await loadChapterTokens(secondChapter!.id, null);
          expect(legacy?.[0]).toMatchObject({ lemmaId: savedId, isOov: false, glossDefault: 'test word' });
          expect(legacy?.[1]).toMatchObject({ lemmaId: null, isOov: true });
          const { getWorkshopWord, previewDraft, searchWorkshop } = await import('./dictionary/workshop.js');
          const native = { ...emptyDraft('मिस' + suffix, 'NOUN'), meaning: 'pretext, pretence, excuse' };
          const loan = { ...native, meaning: 'Miss (title)', loan: true };
          const nativeId = await saveDraft(native, user!.id, 'hi');
          const loanId = await saveDraft({ ...loan, pos: 'PROPN' }, user!.id, 'hi');
          const workaround = await getWorkshopWord(loanId, 'hi');
          expect(await saveDraft({ ...workaround.draft, pos: 'NOUN' }, user!.id, 'hi')).toBe(loanId);
          expect((await searchWorkshop('hi', native.lemma, 10))).toEqual(expect.arrayContaining([
            { id: nativeId, lemma: native.lemma, pos: 'NOUN', meaning: native.meaning },
            { id: loanId, lemma: native.lemma, pos: 'NOUN', meaning: loan.meaning },
          ]));
          await expect(saveDraft(loan, user!.id, 'hi')).rejects.toMatchObject({ status: 409 });
          const third = await saveDraft({ ...native, meaning: 'another meaning' }, user!.id, 'hi');
          expect([nativeId, loanId]).not.toContain(third);
          const basque = { ...emptyDraft('etxe' + suffix), meaning: 'house',
            alternatives: ['etche' + suffix], other: ['etxe zaharra', 'etxeetan'], excluded: ['etxeetan'] };
          const revisionBefore = (await tx.select().from(schema.hindiDictionaryState))[0]!.revision;
          const basqueId = await saveDraft(basque, user!.id, 'eu');
          const [basqueBook] = await tx.insert(schema.texts).values({
            ownerId: user!.id, language: 'eu', title: 'Workshop example', sourceType: 'paste',
          }).returning();
          const [basqueChapter] = await tx.insert(schema.textChapters).values({
            textId: basqueBook!.id, idx: 0, body: basque.alternatives[0]!,
          }).returning();
          await tx.insert(schema.textTokens).values({
            chapterId: basqueChapter!.id, idx: 0, surface: basque.alternatives[0]!.toUpperCase(),
            isWord: true, isOov: true,
          });
          expect((await loadChapterTokens(basqueChapter!.id, null))?.[0]).toMatchObject({
            lemmaId: basqueId, isOov: false, glossDefault: 'house',
          });
          const { draft } = await getWorkshopWord(basqueId, 'eu');
          expect(draft).toMatchObject({ ...basque, id: basqueId, version: expect.any(String) });
          expect(await previewDraft('eu', draft, false)).toEqual({ forms: {
            [basque.lemma]: ['citation'], [basque.alternatives[0]!]: ['alternative-headword'],
            'etxe zaharra': ['explicit-form'],
          } });
          expect(await searchWorkshop('eu', basque.alternatives[0]!, 1)).toMatchObject([{ id: basqueId }]);
          await expect(getWorkshopWord(basqueId, 'hi')).rejects.toMatchObject({ status: 404 });
          await expect(saveDraft(draft, user!.id, 'mr')).rejects.toMatchObject({ status: 404 });
          const updated = { ...draft, other: ['etxeak'], meaning: 'home', alternatives: [] };
          await saveDraft(updated, user!.id, 'eu');
          expect((await getWorkshopWord(basqueId, 'eu')).draft).toMatchObject({ meaning: 'home', other: ['etxeak'] });
          await expect(saveDraft(draft, user!.id, 'eu')).rejects.toMatchObject({ status: 409 });
          expect(await tx.select().from(schema.dictionaryPatternForms).where(eq(schema.dictionaryPatternForms.lemmaId, basqueId))).toEqual([]);
          expect((await tx.select().from(schema.hindiDictionaryState))[0]!.revision).toBe(revisionBefore);
          const { mergeWorkshopWords, previewPhrase } = await import('./dictionary/workshop.js');
          const testVerb = 'egin' + randomUUID().slice(0, 8).replace(/[0-9]/g, 'a');
          const verb = { ...emptyDraft(testVerb, 'VERB'), other: ['egiten', 'eginda'], excluded: ['eginda'] };
          await saveDraft(verb, user!.id, 'eu');
          const phrase = await previewPhrase('eu', 'lan ' + testVerb, testVerb, false);
          expect(Object.keys(phrase.forms).sort()).toEqual(['lan ' + testVerb, 'lan egiten'].sort());
          await expect(previewPhrase('mr', 'lan egin', 'egin', false)).rejects.toMatchObject({ status: 400 });
          const [target] = await tx.insert(schema.lemmas).values({
            language: 'eu', headword: 'etxebizitza', pos: 'NOUN', script: 'Latn',
            source: 'official_dictionary', glossDefault: 'dwelling',
          }).returning();
          const current = await getWorkshopWord(basqueId, 'eu');
          await expect(tx.transaction((nested) => mergeWorkshopWords(
            'mr', nested, basqueId, target!.id, user!.id, current.draft.version,
          ))).rejects.toMatchObject({ status: 404 });
          await mergeWorkshopWords('eu', tx, basqueId, target!.id, user!.id, current.draft.version);
          const merged = await getWorkshopWord(target!.id, 'eu');
          expect(merged.draft.other).toEqual(expect.arrayContaining([basque.lemma, 'etxeak']));
          expect(merged.draft.alternatives).toContain(basque.lemma);
          expect(merged.draft.meaning).toContain('dwelling');
          expect(merged.draft.meaning).toContain('home');
          await expect(getWorkshopWord(basqueId, 'eu')).rejects.toMatchObject({ status: 404 });
          expect((await tx.select().from(schema.hindiDictionaryState))[0]!.revision).toBe(revisionBefore);
          const stem = 'बोल' + [...randomUUID().slice(0, 8)].map((c) => 'कखगघचछजझटठडढतथदध'[parseInt(c, 16)]).join('');
          const infinitive = stem + 'ना';
          await saveDraft({ ...emptyDraft(infinitive, 'VERB'), other: [stem + 'ा', stem + 'कर'], excluded: [stem + 'कर'] }, user!.id, 'hi');
          const hindiPhrase = await previewPhrase('hi', 'न ' + infinitive, infinitive, true);
          expect(Object.keys(hindiPhrase.forms).sort()).toEqual(
            ['न ', 'नहीं '].flatMap((prefix) => [prefix + infinitive, prefix + stem + 'ा']).sort(),
          );
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    } finally {
      await client.end();
    }
  });
  it('compares ambiguous Hindi words and compound spans against a book with ordinary token counts', async () => {
    if (!url || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)) {
      throw new Error('Use a local test database');
    }
    const client = postgres(url, { max: 1 });
    const rollback = new Error('rollback book comparison fixture');
    try {
      await expect(drizzle(client, { schema }).transaction(async tx => {
        state.db = tx as unknown as DB;
        const { compareBooks } = await import('./texts/book-comparison.js');
        const [source, target] = await tx.insert(schema.texts).values(['Source', 'Target'].map(title => ({
          title, language: 'hi' as const, visibility: 'official' as const, status: 'ready' as const,
          sourceType: 'paste' as const,
        }))).returning();
        const [chapter, other] = await tx.insert(schema.textChapters).values([
          { textId: source!.id, idx: 0, body: 'एक दो तीन' },
          { textId: target!.id, idx: 0, body: 'एक' },
        ]).returning();
        const [first, second, compound] = await tx.insert(schema.lemmas).values([0, 1, 2].map(() => ({
          headword: randomUUID(), language: 'hi' as const, source: 'curator' as const, script: 'Deva', pos: 'NOUN',
        }))).returning();
        await tx.insert(schema.textTokens).values([
          ...['एक', ' ', 'दो', ' ', 'तीन'].map((surface, idx) => ({
            chapterId: chapter!.id, idx, surface, isWord: surface !== ' ',
          })),
          { chapterId: other!.id, idx: 0, surface: 'एक', lemmaId: compound!.id, isWord: true },
        ]);
        await tx.insert(schema.hindiChapterAnalyses).values({
          chapterId: chapter!.id, revision: 1, parserVersion: 'test', sourceWords: 3, unresolvedWords: 1, stats: {},
        });
        await tx.insert(schema.hindiOccurrences).values([
          ...[first!, second!].map(lemma => ({ chapterId: chapter!.id, startIdx: 0, endIdx: 1,
            sourceStart: 0, sourceEnd: 2, lemmaId: lemma.id, rules: [] })),
          { chapterId: chapter!.id, startIdx: 0, endIdx: 3, sourceStart: 0, sourceEnd: 5, lemmaId: compound!.id, rules: [] },
        ]);
        await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
        // The first word splits its weight between two readings. The second is matched only by the phrase.
        expect(await compareBooks(target!, source!.id, 33, 100)).toMatchObject({ kind: 'estimate', coverage: 100 });
        const limit = await compareBooks(target!, source!.id, 67, 100);
        expect(limit.kind).toBe('source-limit');
        if (limit.kind === 'source-limit') expect(limit.maximum).toBeCloseTo(200 / 3);
        const { officialDeckRows, studyBands } = await import('./texts/study-deck.js');
        const { studyDeckPlan } = await import('$lib/library/study-deck.js');
        const { getOfficialBookCards } = await import('./texts/official.js');
        const settings = { target: 50, ignoreProper: false, ignoreLoans: false };
        const rows = await officialDeckRows(source!);
        expect(studyDeckPlan(studyBands(rows), { ...settings, scope: 'target' }))
          .toEqual({ count: 2, total: 3, covered: 1.5, reached: true });
        const cards = await getOfficialBookCards(source!.id, randomUUID(), 'target', settings);
        expect(cards.map(c => c.id)).toEqual(rows.filter(r => r.id).slice(0, 2).map(r => r.id));
        expect(cards.map(c => c.frequency)).toEqual([1, 1]);
        const [reader] = await tx.insert(schema.users).values({ email: `${randomUUID()}@example.invalid` }).returning();
        const knownBook = { id: target!.id, coverage: 100 };
        const adjusted = await officialDeckRows(source!, reader!.id, knownBook);
        expect(adjusted.find(row => row.id === compound!.id)?.status).toBe('known');
        const plan = studyDeckPlan(studyBands(adjusted), { ...settings, scope: 'target' });
        expect(plan).toEqual({ count: 1, total: 3, covered: 1.5, reached: true });
        const adjustedCards = await getOfficialBookCards(source!.id, reader!.id, 'target', settings, knownBook);
        expect(adjustedCards.map(card => card.id)).toEqual(adjusted.filter(row => row.status === 'unknown').slice(0, plan.count).map(row => row.id));
        expect((await officialDeckRows(source!, reader!.id)).find(row => row.id === compound!.id)?.status).toBe('unknown');
        await expect(officialDeckRows(target!, reader!.id, { id: source!.id, coverage: 100 })).rejects.toMatchObject({ status: 400 });

        // Ignoring an ambiguous word removes both weighted readings for this reader.
        await tx.execute(sql`INSERT INTO reader_ignored_tokens (user_id,token_id)
          SELECT ${reader!.id},id FROM text_tokens WHERE chapter_id=${chapter!.id} AND idx IN (0,4)`);
        const personal = await officialDeckRows(source!, reader!.id);
        expect(personal.map(row => [row.id,row.frequency,row.matches])).toEqual([[compound!.id,1,1]]);
        expect(await compareBooks(source!, target!.id, 100, 100, reader!.id)).toMatchObject({ coverage: 100, additionalWords: 0 });
        const choice = { chapterId: chapter!.id, sourceOccurrenceId: 'word', sourceStart: 0, sourceEnd: 2,
          selectedLemmaIds: [second!.id], candidateLemmaIds: [first!.id, second!.id], origin: 'human', status: 'confirmed' };
        await tx.insert(schema.hindiContextChoices).values({ ...choice, metadata: { chapter_hash: createHash('md5').update(chapter!.body).digest('hex') } });
        // As a target, the source book has two matched words and one parser gap.
        expect(await compareBooks(source!, target!.id, 100, 60)).toMatchObject({ coverage: expect.closeTo(100 / 3), additionalWords: 1 });
        await tx.update(schema.hindiContextChoices).set({ metadata: { chapter_hash: 'stale' } })
          .where(eq(schema.hindiContextChoices.chapterId, chapter!.id));
        expect(await compareBooks(source!, target!.id, 100, 60)).toMatchObject({ coverage: expect.closeTo(100 / 3), additionalWords: 2 });
        throw rollback;
      })).rejects.toBe(rollback);
    } finally {
      await client.end();
    }
  });

  it('prefers the Parhiba ID and imports every exact Hindi headword match as a fallback', async () => {
    if (!url || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)) {
      throw new Error('Use a local test database');
    }
    const client = postgres(url, { max: 1 });
    const rollback = new Error('rollback Anki fixture');
    try {
      await expect(drizzle(client, { schema }).transaction(async (tx) => {
        state.db = tx as unknown as DB;
        const { importAnkiVocabulary, ankiImportInput } = await import('./anki-import.js');
        const [user] = await tx.insert(schema.users)
          .values({ email: `${randomUUID()}@example.invalid` }).returning();
        const unique = 'नया' + randomUUID();
        const shared = 'अर्थ' + randomUUID();
        const entries = await tx.insert(schema.lemmas).values(
          ([[unique, 'NOUN'], [shared, 'NOUN'], [shared, 'VERB']] as const).map(([headword, pos]) => ({
            language: 'hi' as const, script: 'Deva', source: 'curator' as const, headword, pos,
          })),
        ).returning();
        const parhibaId = entries[2]!.id;
        const run = (apply: boolean, notes: unknown[]) => importAnkiVocabulary(user!.id,
          ankiImportInput.parse({ apply, entries: notes }));
        expect(ankiImportInput.safeParse({ apply: false, entries: [
          { id: 'hi_only', status: 'known' },
        ] }).success).toBe(false);
        const knownById = [{ parhibaId, headword: shared, status: 'known' }];
        expect(await run(false, knownById)).toMatchObject({ matched: 1, changes: 1 });
        expect(await run(true, knownById)).toMatchObject({ matched: 1, changes: 1 });
        expect(await tx.select({ id: schema.userKnownLemmas.lemmaId }).from(schema.userKnownLemmas)
          .where(eq(schema.userKnownLemmas.userId, user!.id))).toEqual([{ id: parhibaId }]);

        const allSenses = [{ headword: shared, status: 'known' }];
        expect(await run(false, allSenses)).toMatchObject({ matched: 2, changes: 1, unmatchedEntries: [] });
        expect(await run(false, [{ ...allSenses[0], parhibaId: randomUUID() }]))
          .toMatchObject({ matched: 2, changes: 1, unmatchedEntries: [] });
        expect(await run(true, allSenses)).toMatchObject({ matched: 2, changes: 1 });
        expect(await run(true, allSenses)).toMatchObject({ matched: 2, changes: 0 });

        const partial = shared.slice(0, -1);
        const notes = [
          { parhibaId, headword: unique, status: 'learning' },
          { headword: unique, status: 'known' },
          { id: 'hi_retired', headword: partial, status: 'known' },
        ];
        expect(await run(false, notes)).toMatchObject({
          matched: 2, changes: 2, counts: { known: 1, learning: 1 },
          unmatchedEntries: [{ headword: partial, parhibaId: null }],
        });
        expect(await run(false, [
          { parhibaId, status: 'ignore' },
          { headword: shared, status: 'learning' },
        ])).toMatchObject({ matched: 1, changes: 1, counts: { learning: 1 } });
        throw rollback;
      })).rejects.toBe(rollback);
    } finally {
      await client.end();
    }
  });

  it('ranks standalone and chapter books together before choosing a catalog page', async () => {
    if (!url || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)) {
      throw new Error('Use a local test database');
    }
    const client = postgres(url, { max: 1 });
    try {
      await drizzle(client, { schema }).transaction(async tx => {
        state.db = tx as unknown as DB;
        for (const table of ['texts', 'collections', 'collection_items', 'book_word_frequencies', 'user_known_lemmas']) {
          await tx.execute(sql`CREATE TEMP TABLE ${sql.identifier(table)} ON COMMIT DROP AS
            SELECT * FROM public.${sql.identifier(table)} WITH NO DATA`);
        }
        for (const table of ['reader_coverage_cache', 'official_coverage_layouts']) {
          await tx.execute(sql`CREATE TEMP TABLE ${sql.identifier(table)}
            (LIKE public.${sql.identifier(table)} INCLUDING ALL) ON COMMIT DROP`);
        }
        await tx.execute(sql`CREATE TEMP TABLE users (id uuid PRIMARY KEY) ON COMMIT DROP`);
        await tx.execute(sql`INSERT INTO texts (id,title,language,visibility,source_type,status,created_at)
          SELECT md5(name)::uuid,name,'hi','official','paste','ready',now()
          FROM (VALUES ('Standalone A'),('Standalone B'),('Chapter 1'),('Chapter 2')) AS titles(name)`);
        await tx.execute(sql`INSERT INTO collections (id,title,language,visibility,kind,created_at)
          VALUES (md5('book')::uuid,'Chapter book','hi','official','chapter_book',now())`);
        await tx.execute(sql`INSERT INTO collection_items (collection_id,text_id)
          SELECT md5('book')::uuid,id FROM texts WHERE title LIKE 'Chapter%'`);
        await tx.execute(sql`INSERT INTO book_word_frequencies (text_id,lemma_id,occurrences)
          SELECT md5(title)::uuid,md5(word)::uuid,n FROM (VALUES
            ('Standalone A','one',9), ('Standalone A','three',1),
            ('Standalone B','one',1), ('Standalone B','two',1), ('Standalone B','three',4),
            ('Chapter 1','one',1), ('Chapter 1','three',1),
            ('Chapter 2','one',1), ('Chapter 2','three',1), ('Chapter 2','four',1)
          ) AS fixture(title,word,n)`);
        const userId = randomUUID();
        await tx.execute(sql`INSERT INTO users VALUES (${userId})`);
        await tx.execute(sql`INSERT INTO user_known_lemmas (user_id,lemma_id,status)
          SELECT ${userId}::uuid,md5(word)::uuid,status::known_lemma_status
          FROM (VALUES ('one','known'),('two','known'),('three','learning')) AS vocabulary(word,status)`);
        const { listOfficialBooks } = await import('./texts/library.js');
        const page = { language: 'hi' as const, limit: 1, offset: 1, userId };
        expect(await listOfficialBooks({ ...page, sort: 'reading' })).toMatchObject({
          totalCount: 3,
          cards: [{ title: 'Standalone B', stats: { words: 6, uniqueWords: 3, knownPct: 33.3, learningPct: 100,
            knownWords: 2, learningWords: 4, knownHeadwords: 2, learningHeadwords: 1 } }],
        });
        // Warm reads must still work with the source frequencies unavailable.
        await tx.execute(sql`ALTER TABLE book_word_frequencies RENAME COLUMN occurrences TO hidden_during_cached_read`);
        expect(await listOfficialBooks({ ...page, sort: 'unique' })).toMatchObject({
          totalCount: 3, cards: [{ title: 'Standalone A', stats: { knownPct: 90, uniquePct: 50 } }],
        });
        await tx.execute(sql`ALTER TABLE book_word_frequencies RENAME COLUMN hidden_during_cached_read TO occurrences`);
        expect(await listOfficialBooks({ ...page, sort: 'recent', userId: undefined })).toMatchObject({
          totalCount: 3, cards: [{ stats: { knownPct: null, uniquePct: null } }],
        });
      });
    } finally {
      await client.end();
    }
  });

});
