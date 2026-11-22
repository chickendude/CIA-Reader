// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { expect, it, vi } from 'vitest';
import type { DB } from '../db/index';
import * as schema from '../db/schema';
import type { NlpToken } from '../nlp-client';

const state = vi.hoisted(() => ({ db: undefined as unknown as DB }));
vi.mock('../db/index.js', async () => ({
  get db() {
    return state.db;
  },
  schema: await import('../db/schema.js'),
}));

const url = process.env.HINDIDB_TEST_DATABASE_URL;
it.skipIf(!url)(
  'merges and restores a single occurrence, including reprocessed and older merges',
  async () => {
    if (!url || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname))
      throw new Error('Use a local test database');
    const client = postgres(url, { max: 1 });
    const rollback = new Error('rollback fixture');
    try {
      await expect(
        drizzle(client, { schema }).transaction(async (tx) => {
          state.db = tx as unknown as DB;
          const { persistHindiTokens, confirmHindiMerge, undoHindiMerge } =
            await import('./hindidb');
          const { loadChapterTokens } = await import('./tokens');
          const { reviewPage } = await import('./hindi-review');
          const [user] = await tx
            .insert(schema.users)
            .values({ email: randomUUID() + '@example.invalid' })
            .returning();
          const [book] = await tx
            .insert(schema.texts)
            .values({
              ownerId: user!.id,
              language: 'hi',
              title: 'Merge test',
              sourceType: 'paste',
            })
            .returning();
          const source = 'विन्ग-गार-डियम लेवि-यो-सा';
          const headword = 'विन्गार्डियम लेवियोसा';
          const body = source + '। ' + source;
          const [ch] = await tx
            .insert(schema.textChapters)
            .values({ textId: book!.id, idx: 0, body })
            .returning();
          await tx.insert(schema.hindiDictionaryState).values({ id: 1 }).onConflictDoNothing();
          const [entry] = await tx
            .insert(schema.lemmas)
            .values({
              language: 'hi',
              script: 'Deva',
              pos: 'PROPN',
              source: 'curator',
              headword,
            })
            .returning();
          const tokens: NlpToken[] = [...body.matchAll(/[\p{L}\p{M}]+|\s+|./gu)].map(
            ([surface], idx) => ({
              idx,
              surface,
              candidates: [],
              is_word: /\p{L}/u.test(surface),
              is_oov: /\p{L}/u.test(surface),
              number_forms: null,
              romanization: null,
              is_ambiguous: false,
            }),
          );
          const [fragment] = await tx
            .insert(schema.lemmas)
            .values({
              language: 'hi',
              script: 'Deva',
              pos: 'NOUN',
              headword: 'गार',
              source: 'curator',
            })
            .returning();
          tokens[2]!.candidates = [
            {
              dictionary_id: fragment!.id,
              lemma: 'गार',
              pos: 'NOUN',
              features: { Case: 'Nom' },
              score: 1,
            },
          ];
          tokens[2]!.is_oov = false;
          const readings = [
            {
              start_idx: 2,
              end_idx: 3,
              source_start: 6,
              source_end: 9,
              lemma_id: fragment!.id,
              rules: ['headword'],
            },
          ];
          const [dict] = await tx.select().from(schema.hindiDictionaryState);
          const parse = () =>
            persistHindiTokens(ch!.id, tokens, {
              revision: dict!.revision,
              parser_version: 'test',
              stats: { source_words: 12, unresolved_occurrences: 11 },
              occurrences: readings,
            });
          await parse();
          const before = (await loadChapterTokens(ch!.id, user!.id))!;
          const { setOccurrenceIgnored } = await import('./ignored-occurrences');
          const { libraryBookStats } = await import('./book-stats');
          const { lemmaBookFrequency, lemmaBookFrequencies } = await import('./book-frequency');
          const { getAnkiCards } = await import('../anki');
          const { studyFrequencies } = await import('./study-frequencies');
          const frequency = () => lemmaBookFrequency(book!.id, fragment!.id, user!.id);
          const stats = async () => (await libraryBookStats([book!.id], [], user!.id))[book!.id];
          const studyCount = async () => {
            const [row] = await tx.execute(sql`SELECT coalesce(sum(occurrences),0)::int AS n
              FROM (${studyFrequencies(sql`SELECT ${book!.id}::uuid AS id`, 'hi', user!.id)}) f`);
            return row!.n;
          };
          await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
          expect(await frequency()).toEqual({ book: 1, text: 1 });
          await setOccurrenceIgnored(user!.id, before[2]!.id, true);
          expect(await stats()).toMatchObject({ words: 11, uniqueWords: 0, unparsedWords: 11 });
          expect(await studyCount()).toBe(11);
          expect(await frequency()).toEqual({ book: 0, text: 0 });
          expect((await lemmaBookFrequencies(book!.id, [fragment!.id], user!.id)).get(fragment!.id)).toBe(0);
          expect((await getAnkiCards(user!.id, { textId: book!.id })).cards).toEqual([]);
          expect((await libraryBookStats([book!.id], []))[book!.id]).toMatchObject({ words: 12, uniqueWords: 1 });
          await setOccurrenceIgnored(user!.id, before[2]!.id, false);
          expect(await stats()).toMatchObject({ words: 12, uniqueWords: 1 });
          expect(await frequency()).toEqual({ book: 1, text: 1 });
          await setOccurrenceIgnored(user!.id, before[0]!.id, true);
          expect(await stats()).toMatchObject({ words: 11, uniqueWords: 1, unparsedWords: 10 });
          expect(await studyCount()).toBe(11);
          await setOccurrenceIgnored(user!.id, before[0]!.id, false);
          await tx.execute(sql`SET CONSTRAINTS ALL DEFERRED`);
          const option = before[8]!.mergeOptions!.find((m) => m.lemmaId === entry!.id)!;
          expect(option.surface).toBe(source);
          await expect(
            confirmHindiMerge(ch!.id, { ...option, last: 18 }, user!),
          ).rejects.toMatchObject({ status: 409 });
          await expect(
            confirmHindiMerge(ch!.id, option, { ...user!, id: randomUUID() }),
          ).rejects.toMatchObject({ status: 404 });
          await confirmHindiMerge(ch!.id, option, user!);
          await confirmHindiMerge(ch!.id, option, user!);
          const verify = async () => {
            const after = (await loadChapterTokens(ch!.id, user!.id))!;
            expect(after[0]).toMatchObject({
              id: before[0]!.id,
              surface: source,
              lemmaId: entry!.id,
              headword,
            });
            expect(after.map((t) => t.surface).join('')).toBe(body);
            expect(after.filter((t) => t.isWord)).toHaveLength(7);
            expect(after.at(-1)?.mergeOptions).toEqual(before.at(-1)?.mergeOptions);
            const [analysis] = await tx
              .select()
              .from(schema.hindiChapterAnalyses)
              .where(eq(schema.hindiChapterAnalyses.chapterId, ch!.id));
            expect(analysis).toMatchObject({ sourceWords: 7, unresolvedWords: 6 });
            const review = await reviewPage(
              book!.id,
              { ...user!, role: 'admin' },
              0,
              '',
              'unparsed',
            );
            expect(review.total).toBe(6);
          };
          await verify();
          await parse();
          await verify();
          const other = before.at(-1)!.mergeOptions!.find((m) => m.lemmaId === entry!.id)!;
          await confirmHindiMerge(ch!.id, other, user!);
          await expect(
            undoHindiMerge(ch!.id, option, { ...user!, id: randomUUID() }),
          ).rejects.toMatchObject({ status: 404 });
          await expect(
            undoHindiMerge(ch!.id, { ...option, last: other.last }, user!),
          ).rejects.toMatchObject({ status: 409 });
          await undoHindiMerge(ch!.id, option, user!);
          await undoHindiMerge(ch!.id, option, user!);
          const undone = (await loadChapterTokens(ch!.id, user!.id))!;
          expect(undone.slice(0, option.last + 1)).toEqual(before.slice(0, option.last + 1));
          expect(undone.at(-1)?.confirmedMerge).toEqual(other);
          const [counts] = await tx
            .select()
            .from(schema.hindiChapterAnalyses)
            .where(eq(schema.hindiChapterAnalyses.chapterId, ch!.id));
          expect(counts).toMatchObject({ sourceWords: 7, unresolvedWords: 5 });
          expect(
            await tx
              .select()
              .from(schema.hindiOccurrences)
              .where(eq(schema.hindiOccurrences.chapterId, ch!.id)),
          ).toContainEqual({
            chapterId: ch!.id,
            startIdx: 2,
            endIdx: 3,
            sourceStart: 6,
            sourceEnd: 9,
            lemmaId: fragment!.id,
            rules: ['headword'],
          });
          await parse();
          expect((await loadChapterTokens(ch!.id, user!.id))!.at(-1)?.confirmedMerge).toEqual(
            other,
          );

          await tx.execute(
            sql`UPDATE hindi_chapter_analyses SET stats=stats-'syllable_merge_originals' WHERE chapter_id=${ch!.id}`,
          );
          const { nlpClient } = await import('../nlp-client');
          const process = vi.spyOn(nlpClient, 'process').mockResolvedValueOnce({
            language: 'hi',
            pipeline_id: 'hindidb',
            tokens,
            hindi_analysis: {
              revision: dict!.revision,
              parser_version: 'test',
              stats: { source_words: 12, unresolved_occurrences: 11 },
              occurrences: readings,
            },
          });
          try {
            await undoHindiMerge(ch!.id, other, user!);
            expect(process).toHaveBeenCalledWith('hi', body);
            expect(await loadChapterTokens(ch!.id, user!.id)).toEqual(before);
          } finally {
            process.mockRestore();
          }
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    } finally {
      await client.end();
    }
  },
);
