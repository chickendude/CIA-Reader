import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { HindiAnalysis, NlpToken, OcrBBox } from '../nlp-client.js';

/** Keep display tokens and all-candidate counts in the same transaction. */
export async function persistHindiTokens(
  chapterId: string,
  tokens: Array<NlpToken & { bbox?: OcrBBox | null }>,
  analysis: HindiAnalysis,
): Promise<number> {
  await db.transaction(async (tx) => {
    const [state] = await tx.select().from(schema.hindiDictionaryState).for('share');
    if (!state || state.revision !== analysis.revision) {
      throw new Error('Hindi dictionary changed during processing; reprocess this text.');
    }
    await tx.delete(schema.textTokens).where(eq(schema.textTokens.chapterId, chapterId));
    await tx
      .delete(schema.hindiOccurrences)
      .where(eq(schema.hindiOccurrences.chapterId, chapterId));
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
      await tx.insert(schema.textTokens).values(rows.slice(start, start + 1000));
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
  });
  return tokens.length;
}
