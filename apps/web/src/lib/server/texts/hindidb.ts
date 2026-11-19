import { createHash } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { applyHindiStutters, chapterStutters, projectStutters } from './hindi-stutters.js';
import type { HindiAnalysis, NlpToken, OcrBBox } from '../nlp-client.js';

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
    const { chapter, hash, spans } = await lockChapter(tx, chapterId);
    const hasHyphen = /[-‐‑]/u.test(chapter.body);
    if (hasHyphen) {
      if (tokens.map((t) => t.surface).join('') !== chapter.body)
        error(409, 'The chapter changed during processing.');
      const result = applyHindiStutters(tokens, analysis, spans, hash);
      return writeHindiTokens(tx, chapterId, result.tokens, result.analysis);
    }
    return writeHindiTokens(tx, chapterId, tokens, analysis);
  });
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
  await tx.delete(schema.hindiOccurrences).where(eq(schema.hindiOccurrences.chapterId, chapterId));
  await tx
    .delete(schema.phraseChapterSpans)
    .where(eq(schema.phraseChapterSpans.chapterId, chapterId));
  const rows = tokens.map((t) => ({
    chapterId,
    idx: t.idx,
    surface: t.surface,
    lemmaId: t.candidates[0]?.dictionary_id ?? null,
    lemmaCandidates: t.candidates.map((c) => ({
      lemmaId: c.dictionary_id ?? null,
      features: c.features,
      score: 1,
    })),
    features: t.candidates[0]?.features ?? {},
    isAmbiguous: t.is_ambiguous,
    isOov: t.is_oov,
    isWord: t.is_word,
    sentenceIdx: t.sentence_idx ?? 0,
    romanization: t.romanization,
    numberForms: t.number_forms ?? null,
    bbox: t.bbox ?? null,
  }));
  for (let start = 0; start < rows.length; start += 1000) {
    await tx
      .insert(schema.textTokens)
      .values(rows.slice(start, start + 1000))
      .onConflictDoUpdate({
        target: [schema.textTokens.chapterId, schema.textTokens.idx],
        set: {
          lemmaId: sql`excluded.lemma_id`,
          lemmaCandidates: sql`excluded.lemma_candidates`,
          features: sql`excluded.features`,
          isAmbiguous: sql`excluded.is_ambiguous`,
          isOov: sql`excluded.is_oov`,
          isWord: sql`excluded.is_word`,
          sentenceIdx: sql`excluded.sentence_idx`,
          romanization: sql`excluded.romanization`,
          numberForms: sql`excluded.number_forms`,
          bbox: sql`excluded.bbox`,
        },
      });
  }
  const occurrences = analysis.occurrences.map((o) => ({
    chapterId,
    startIdx: o.start_idx,
    endIdx: o.end_idx,
    lemmaId: o.lemma_id,
    sourceStart: o.source_start,
    sourceEnd: o.source_end,
    rules: o.rules,
  }));
  for (let start = 0; start < occurrences.length; start += 1000) {
    await tx.insert(schema.hindiOccurrences).values(occurrences.slice(start, start + 1000));
  }
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
    .onConflictDoUpdate({ target: schema.hindiChapterAnalyses.chapterId, set: record });
  await tx
    .update(schema.textChapters)
    .set({ tokenCount: analysis.stats.source_words })
    .where(eq(schema.textChapters.id, chapterId));
  return tokens.length;
}
