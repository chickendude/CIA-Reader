import { createHash } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { and, between, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import {
  applyHindiStutters,
  chapterStutters,
  detectStutters,
  projectStutters,
} from './hindi-stutters.js';
import {
  coveredStutters,
  fragmentReading,
  hindiMergeStats,
  mergeOriginals,
  originalForMerge,
  projectHindiMerges,
  sameMerge,
  storedHindiMerges,
  type MergeSelection,
} from './hindi-merge-projection.js';
import { hindiMergeEntries } from './hindi-merges.js';
import { canReadText } from '../auth/can-read.js';
import { isCuratorOrAdmin } from '../dictionary/permissions.js';
import type { User } from '../db/schema.js';
import { hindiSyllableRuns, matchHindiMerges } from '$lib/dictionary/hindi-merge';
import { nlpClient, type HindiAnalysis, type NlpToken, type OcrBBox } from '../nlp-client.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type StoredToken = NlpToken & { bbox?: OcrBBox | null };

async function lockChapter(tx: Tx, chapterId: string) {
  const [chapter] = await tx
    .select()
    .from(schema.textChapters)
    .where(eq(schema.textChapters.id, chapterId))
    .for('update');
  if (!chapter) error(404, 'Chapter not found');
  const [analysis] = await tx
    .select()
    .from(schema.hindiChapterAnalyses)
    .where(eq(schema.hindiChapterAnalyses.chapterId, chapterId));
  const hash = createHash('sha256').update(chapter.body).digest('hex');
  const spans = analysis?.stats.stutter_text_hash === hash ? chapterStutters(analysis.stats) : [];
  return { chapter, hash, spans, analysis };
}

export async function persistHindiTokens(
  chapterId: string,
  tokens: StoredToken[],
  analysis: HindiAnalysis,
) {
  return db.transaction(async (tx) => {
    const { chapter, hash, spans, analysis: previous } = await lockChapter(tx, chapterId);
    const hasHyphen = /[-‐‑]/u.test(chapter.body);
    if (hasHyphen) {
      if (tokens.map((t) => t.surface).join('') !== chapter.body)
        error(409, 'The chapter changed during processing.');
      const reviewed =
        previous?.stats.stutter_text_hash === hash
          ? [...spans, ...coveredStutters(previous.stats)]
          : spans;
      const result = applyHindiStutters(tokens, analysis, reviewed, hash);
      const saved =
        previous?.stats.stutter_text_hash === hash ? storedHindiMerges(previous.stats) : [];
      if (!saved.length) return writeHindiTokens(tx, chapterId, result.tokens, result.analysis);
      const entries = await hindiMergeEntries(
        tx,
        inArray(
          sql`l.id`,
          saved.map((m) => m.lemmaId),
        ),
      );
      const options = matchHindiMerges(
        hindiSyllableRuns(result.tokens.map((t) => ({ ...t, isWord: t.is_word }))),
        entries,
      );
      const valid = options.filter((m) => saved.some((s) => sameMerge(s, m)));
      const projected = projectHindiMerges(
        result.tokens,
        result.analysis.occurrences,
        result.analysis.stats,
        valid,
        fragmentReading,
      );
      return writeHindiTokens(tx, chapterId, projected.tokens, {
        ...result.analysis,
        stats: projected.stats,
        occurrences: projected.occurrences,
      });
    }
    return writeHindiTokens(tx, chapterId, tokens, analysis);
  });
}

async function mergeChapter(tx: Tx, chapterId: string, actor: Pick<User, 'id' | 'role'>) {
  const { chapter, hash, analysis } = await lockChapter(tx, chapterId);
  const [book] = await tx
    .select()
    .from(schema.texts)
    .where(eq(schema.texts.id, chapter.textId))
    .for('share');
  if (!book || book.language !== 'hi' || !(await canReadText(actor, book)))
    error(404, 'Book not found');
  if (book.visibility === 'official' ? !isCuratorOrAdmin(actor) : actor.id !== book.ownerId)
    error(403, 'Only the owner or Official library staff can merge this occurrence');
  if (!analysis) error(409, 'Process the chapter before merging its words.');
  const tokens = await tx
    .select({
      idx: schema.textTokens.idx,
      surface: schema.textTokens.surface,
      isWord: schema.textTokens.isWord,
      isOov: schema.textTokens.isOov,
      isAmbiguous: schema.textTokens.isAmbiguous,
      lemmaId: schema.textTokens.lemmaId,
      lemmaCandidates: schema.textTokens.lemmaCandidates,
      features: schema.textTokens.features,
    })
    .from(schema.textTokens)
    .where(eq(schema.textTokens.chapterId, chapterId))
    .orderBy(schema.textTokens.idx);
  if (tokens.map((t) => t.surface).join('') !== chapter.body)
    error(409, 'The chapter text changed.');
  return { chapter, hash, analysis, tokens };
}

function chapterOccurrences(tx: Tx, chapterId: string) {
  return tx
    .select({
      start_idx: schema.hindiOccurrences.startIdx,
      end_idx: schema.hindiOccurrences.endIdx,
      source_start: schema.hindiOccurrences.sourceStart,
      source_end: schema.hindiOccurrences.sourceEnd,
      lemma_id: schema.hindiOccurrences.lemmaId,
      rules: schema.hindiOccurrences.rules,
    })
    .from(schema.hindiOccurrences)
    .where(eq(schema.hindiOccurrences.chapterId, chapterId));
}

async function replaceMergeOccurrences(
  tx: Tx,
  chapterId: string,
  merge: MergeSelection,
  occurrences: HindiAnalysis['occurrences'],
) {
  await tx
    .delete(schema.hindiOccurrences)
    .where(
      and(
        eq(schema.hindiOccurrences.chapterId, chapterId),
        between(schema.hindiOccurrences.startIdx, merge.first, merge.last),
      ),
    );
  if (occurrences.length)
    await tx.insert(schema.hindiOccurrences).values(
      occurrences.map((o) => ({
        chapterId,
        startIdx: o.start_idx,
        endIdx: o.end_idx,
        sourceStart: o.source_start,
        sourceEnd: o.source_end,
        lemmaId: o.lemma_id,
        rules: o.rules,
      })),
    );
}

async function writeMergeStats(tx: Tx, chapterId: string, stats: HindiAnalysis['stats']) {
  await tx
    .update(schema.hindiChapterAnalyses)
    .set({ stats, sourceWords: stats.source_words, unresolvedWords: stats.unresolved_occurrences })
    .where(eq(schema.hindiChapterAnalyses.chapterId, chapterId));
  await tx
    .update(schema.textChapters)
    .set({ tokenCount: stats.source_words })
    .where(eq(schema.textChapters.id, chapterId));
}

export async function confirmHindiMerge(
  chapterId: string,
  selection: MergeSelection,
  actor: Pick<User, 'id' | 'role'>,
) {
  await db.transaction(async (tx) => {
    const { hash, analysis, tokens } = await mergeChapter(tx, chapterId, actor);
    const saved = storedHindiMerges(analysis.stats);
    if (saved.some((m) => sameMerge(m, selection))) return;
    const entries = await hindiMergeEntries(tx, sql`l.id=${selection.lemmaId}`, true);
    const options = matchHindiMerges(hindiSyllableRuns(tokens), entries);
    const match = options.find((m) => sameMerge(m, selection));
    if (!match || saved.some((m) => m.first <= match.last && match.first <= m.last))
      error(409, 'This dictionary match changed. Reopen the chapter.');
    const occurrences = await chapterOccurrences(tx, chapterId);
    const projected = projectHindiMerges(
      tokens.map((t) => ({
        idx: t.idx,
        surface: t.surface,
        is_word: t.isWord,
        is_oov: t.isOov,
        original: t,
      })),
      occurrences,
      {
        ...analysis.stats,
        source_words: analysis.sourceWords,
        unresolved_occurrences: analysis.unresolvedWords,
      },
      [match],
      (t) => t.original,
    );
    const merged = projected.occurrences.find((o) => o.start_idx === match.first)!;
    await replaceMergeOccurrences(tx, chapterId, match, [merged]);
    await tx.execute(sql`UPDATE text_tokens SET is_word=(idx=${match.first}),is_oov=false,is_ambiguous=false,
      lemma_id=CASE WHEN idx=${match.first} THEN ${match.lemmaId}::uuid END,
      lemma_candidates=CASE WHEN idx=${match.first}
        THEN ${JSON.stringify([{ lemmaId: match.lemmaId, features: {}, score: 1 }])}::jsonb ELSE '[]'::jsonb END,
      features='{}' WHERE chapter_id=${chapterId} AND idx BETWEEN ${match.first} AND ${match.last}`);
    await writeMergeStats(tx, chapterId, { ...projected.stats, stutter_text_hash: hash });
  });
}

export async function undoHindiMerge(
  chapterId: string,
  selection: MergeSelection,
  actor: Pick<User, 'id' | 'role'>,
) {
  type Parse = Awaited<ReturnType<typeof nlpClient.process>>;
  const restore = (fresh?: { body: string; parse: Parse }) =>
    db.transaction(async (tx) => {
      const { chapter, hash, analysis, tokens } = await mergeChapter(tx, chapterId, actor);
      const saved = storedHindiMerges(analysis.stats);
      const merge = saved.find((m) => sameMerge(m, selection));
      if (!merge) {
        if (saved.some((m) => m.first <= selection.last && selection.first <= m.last))
          error(409, 'This merge changed. Reopen the word.');
        return;
      }
      if (analysis.stats.stutter_text_hash !== hash) error(409, 'The chapter text changed.');
      const originals = { ...mergeOriginals(analysis.stats) };
      let original = originals[merge.first];
      if (fresh) {
        const { parse } = fresh;
        const [dict] = await tx.select().from(schema.hindiDictionaryState).for('share');
        if (
          fresh.body !== chapter.body ||
          !parse.hindi_analysis ||
          parse.hindi_analysis.revision !== dict?.revision ||
          tokens.length !== parse.tokens.length ||
          tokens.some(
            (t, i) => t.idx !== parse.tokens[i]?.idx || t.surface !== parse.tokens[i]?.surface,
          )
        )
          error(409, 'The chapter or dictionary changed. Reopen the word and try again.');
        const stutters = detectStutters(
          parse.tokens,
          parse.hindi_analysis.occurrences,
          chapterStutters(analysis.stats),
        );
        original = originalForMerge(
          merge,
          parse.tokens.map(fragmentReading),
          parse.hindi_analysis.occurrences,
          stutters.map((s) => (s.status === 'auto' ? { ...s, status: 'separate' } : s)),
        );
      } else if (original) {
        const ids = new Set([
          ...original.occurrences.map((o) => o.lemma_id),
          ...original.tokens.flatMap((t) =>
            [t.lemmaId, ...t.lemmaCandidates.map((c) => c.lemmaId)].filter(
              (id): id is string => !!id,
            ),
          ),
        ]);
        if (ids.size) {
          const current = await tx
            .select({ id: schema.lemmas.id })
            .from(schema.lemmas)
            .where(inArray(schema.lemmas.id, [...ids]))
            .for('share');
          if (current.length !== ids.size) original = undefined;
        }
      }
      // Older merges have no saved fragment readings. Parse outside the chapter lock.
      if (!original) return chapter.body;
      const restored = new Map(original.tokens.map((t) => [t.idx, t]));
      if (
        restored.size !== merge.last - merge.first + 1 ||
        original.tokens.map((t) => t.surface).join('') !== merge.surface ||
        original.tokens.some((t) => tokens[t.idx]?.surface !== t.surface)
      )
        error(409, 'The source words changed. Reopen the chapter.');
      for (const t of original.tokens) {
        await tx
          .update(schema.textTokens)
          .set({
            isWord: t.isWord,
            isOov: t.isOov,
            isAmbiguous: t.isAmbiguous,
            lemmaId: t.lemmaId,
            features: t.features,
            lemmaCandidates: t.lemmaCandidates,
          })
          .where(and(eq(schema.textTokens.chapterId, chapterId), eq(schema.textTokens.idx, t.idx)));
      }
      await replaceMergeOccurrences(tx, chapterId, merge, original.occurrences);
      delete originals[merge.first];
      const words = tokens.map((t) => {
        const reading = restored.get(t.idx) ?? t;
        return { idx: t.idx, surface: t.surface, is_word: reading.isWord, is_oov: reading.isOov };
      });
      const stats = hindiMergeStats(
        words,
        await chapterOccurrences(tx, chapterId),
        {
          ...analysis.stats,
          syllable_merge_originals: originals,
          stutters: [...chapterStutters(analysis.stats), ...original.stutters],
        },
        saved.filter((m) => m !== merge),
      );
      await writeMergeStats(tx, chapterId, stats);
    });
  const body = await restore();
  if (body !== undefined) {
    const parse = await nlpClient.process('hi', body);
    await restore({ body, parse });
  }
}

export async function reviewHindiStutter(
  actor: string,
  chapterId: string,
  start: number,
  surface: string,
  hash: string,
  confirm: boolean,
) {
  await db.transaction(async (tx) => {
    const locked = await lockChapter(tx, chapterId);
    const [book] = await tx.execute(sql`SELECT id FROM texts WHERE id=${locked.chapter.textId}
      AND language='hi' AND (owner_id=${actor} OR visibility='official') FOR SHARE`);
    if (!book) error(404, 'Book not found');
    const span = locked.spans.find((s) => s.start === start && s.surface === surface);
    if (locked.hash !== hash || span?.status !== 'pending')
      error(409, 'This occurrence changed. Refresh Book review.');
    const analysis = locked.analysis!;
    span.status = confirm ? 'confirmed' : 'separate';
    if (!confirm) {
      await tx
        .update(schema.hindiChapterAnalyses)
        .set({ stats: { ...analysis.stats, stutters: locked.spans } })
        .where(eq(schema.hindiChapterAnalyses.chapterId, chapterId));
      return;
    }
    const tokens = await tx
      .select({
        idx: schema.textTokens.idx,
        surface: schema.textTokens.surface,
        is_word: schema.textTokens.isWord,
        is_oov: schema.textTokens.isOov,
      })
      .from(schema.textTokens)
      .where(eq(schema.textTokens.chapterId, chapterId))
      .orderBy(schema.textTokens.idx);
    if (
      tokens
        .slice(span.first, span.word + 1)
        .map((t) => t.surface)
        .join('') !== span.surface
    )
      error(409, 'The stored words changed. Refresh Book review.');
    const occurrences = await tx
      .select({
        start_idx: schema.hindiOccurrences.startIdx,
        end_idx: schema.hindiOccurrences.endIdx,
        lemma_id: schema.hindiOccurrences.lemmaId,
      })
      .from(schema.hindiOccurrences)
      .where(eq(schema.hindiOccurrences.chapterId, chapterId));
    const { stats } = projectStutters(
      tokens,
      occurrences,
      {
        ...analysis.stats,
        source_words: analysis.sourceWords,
        unresolved_occurrences: analysis.unresolvedWords,
      },
      locked.spans,
      hash,
    );
    await tx.execute(sql`UPDATE text_tokens SET is_word=false, is_oov=false, lemma_id=NULL,
      lemma_candidates='[]', features='{}', is_ambiguous=false
      WHERE chapter_id=${chapterId} AND idx>=${span.first} AND idx<${span.word}`);
    await tx.execute(sql`DELETE FROM hindi_occurrences
      WHERE chapter_id=${chapterId} AND start_idx>=${span.first} AND start_idx<${span.word}`);
    await tx
      .update(schema.hindiChapterAnalyses)
      .set({
        stats,
        sourceWords: stats.source_words,
        unresolvedWords: stats.unresolved_occurrences,
      })
      .where(eq(schema.hindiChapterAnalyses.chapterId, chapterId));
    await tx
      .update(schema.textChapters)
      .set({ tokenCount: stats.source_words })
      .where(eq(schema.textChapters.id, chapterId));
  });
}

async function writeHindiTokens(
  tx: Tx,
  chapterId: string,
  tokens: StoredToken[],
  analysis: HindiAnalysis,
) {
  const [state] = await tx.select().from(schema.hindiDictionaryState).for('share');
  if (!state || state.revision !== analysis.revision) {
    throw new Error('Hindi dictionary changed during processing; reprocess this text.');
  }
  const existing = await tx
    .select({
      id: schema.textTokens.id,
      idx: schema.textTokens.idx,
      surface: schema.textTokens.surface,
    })
    .from(schema.textTokens)
    .where(eq(schema.textTokens.chapterId, chapterId))
    .orderBy(schema.textTokens.idx);
  let oldOffset = 0,
    newOffset = 0;
  const starts = tokens.map((token) => {
    const start = newOffset;
    newOffset += token.surface.length;
    return start;
  });
  const stale = existing.filter((token) => {
    const start = oldOffset;
    oldOffset += token.surface.length;
    return starts[token.idx] !== start || tokens[token.idx]?.surface !== token.surface;
  });
  for (let i = 0; i < stale.length; i += 1000)
    await tx.delete(schema.textTokens).where(
      inArray(
        schema.textTokens.id,
        stale.slice(i, i + 1000).map((t) => t.id),
      ),
    );
  await tx
    .delete(schema.phraseChapterSpans)
    .where(eq(schema.phraseChapterSpans.chapterId, chapterId));

  // Send one record set per chapter. Matching tokens keep their IDs and reader annotations.
  const rows = tokens.map((token) => {
    const reading = fragmentReading(token);
    return {
      idx: token.idx, surface: token.surface, lemma_id: reading.lemmaId,
      lemma_candidates: reading.lemmaCandidates, features: reading.features,
      is_ambiguous: reading.isAmbiguous, is_oov: reading.isOov, is_word: reading.isWord,
      sentence_idx: token.sentence_idx ?? 0, romanization: token.romanization,
      number_forms: token.number_forms ?? null, bbox: token.bbox ?? null,
    };
  });
  await tx.execute(sql`
    MERGE INTO text_tokens t
    USING jsonb_populate_recordset(NULL::text_tokens, ${JSON.stringify(rows)}::jsonb) n
    ON t.chapter_id = ${chapterId} AND t.idx = n.idx
    WHEN MATCHED AND (t.lemma_id, t.lemma_candidates, t.features, t.is_ambiguous, t.is_oov,
      t.is_word, t.sentence_idx, t.romanization, t.number_forms, t.bbox) IS DISTINCT FROM
      (n.lemma_id, n.lemma_candidates, n.features, n.is_ambiguous, n.is_oov,
      n.is_word, n.sentence_idx, n.romanization, n.number_forms, n.bbox)
    THEN UPDATE SET lemma_id=n.lemma_id, lemma_candidates=n.lemma_candidates, features=n.features,
      is_ambiguous=n.is_ambiguous, is_oov=n.is_oov, is_word=n.is_word, sentence_idx=n.sentence_idx,
      romanization=n.romanization, number_forms=n.number_forms, bbox=n.bbox
    WHEN NOT MATCHED THEN INSERT (chapter_id, idx, surface, lemma_id, lemma_candidates, features,
      is_ambiguous, is_oov, is_word, sentence_idx, romanization, number_forms, bbox)
    VALUES (${chapterId}, n.idx, n.surface, n.lemma_id, n.lemma_candidates, n.features,
      n.is_ambiguous, n.is_oov, n.is_word, n.sentence_idx, n.romanization, n.number_forms, n.bbox)
  `);
  // Matches can disappear after dictionary edits, including when a chapter becomes empty.
  await tx.execute(sql`
    WITH incoming AS MATERIALIZED (
      SELECT * FROM jsonb_populate_recordset(NULL::hindi_occurrences,
        ${JSON.stringify(analysis.occurrences)}::jsonb)
    ), removed AS (
      DELETE FROM hindi_occurrences o WHERE o.chapter_id=${chapterId}
        AND NOT EXISTS (SELECT FROM incoming n WHERE
          (n.start_idx,n.end_idx,n.lemma_id)=(o.start_idx,o.end_idx,o.lemma_id))
    )
    INSERT INTO hindi_occurrences AS o (chapter_id,start_idx,end_idx,lemma_id,source_start,source_end,rules)
      SELECT ${chapterId},start_idx,end_idx,lemma_id,source_start,source_end,rules FROM incoming
    ON CONFLICT (chapter_id,start_idx,end_idx,lemma_id) DO UPDATE SET
      source_start=excluded.source_start, source_end=excluded.source_end, rules=excluded.rules
      WHERE (o.source_start,o.source_end,o.rules) IS DISTINCT FROM
        (excluded.source_start,excluded.source_end,excluded.rules)
  `);
  const record = {
    chapterId,
    revision: analysis.revision,
    parserVersion: analysis.parser_version,
    sourceWords: analysis.stats.source_words,
    unresolvedWords: analysis.stats.unresolved_occurrences,
    stats: { ...analysis.stats, constructions: analysis.constructions ?? [] },
  };
  await tx
    .insert(schema.hindiChapterAnalyses)
    .values(record)
    .onConflictDoUpdate({
      target: schema.hindiChapterAnalyses.chapterId,
      set: record,
      setWhere: sql`(hindi_chapter_analyses.revision, hindi_chapter_analyses.parser_version,
        hindi_chapter_analyses.source_words, hindi_chapter_analyses.unresolved_words, hindi_chapter_analyses.stats)
        IS DISTINCT FROM (excluded.revision, excluded.parser_version, excluded.source_words,
        excluded.unresolved_words, excluded.stats)`,
    });
  await tx
    .update(schema.textChapters)
    .set({ tokenCount: analysis.stats.source_words })
    .where(eq(schema.textChapters.id, chapterId));
  return tokens.length;
}
