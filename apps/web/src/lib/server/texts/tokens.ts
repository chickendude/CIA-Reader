/**
 * Reader token + known-status loader.
 *
 * The NLP worker writes `text_tokens` rows during processing.
 * Once the worker has run, the reader pulls those rows + a
 * join through `user_known_lemmas` so each token can render with the
 * right `.status-*` class.
 *
 * Until the worker runs, `loadChapterTokens` returns `null` for
 * chapters with no rows yet — the reader falls back to its
 * client-side whitespace tokenizer in that case (still readable, just
 * no lemma colouring).
 */
import { and, eq, getTableColumns, inArray, isNotNull, sql } from 'drizzle-orm';

import type { LanguageCode } from '@ciareader/shared-types';

import { liveDictionaryMatches } from '../dictionary/live-matches';
import { db, schema } from '../db/index.js';
import type { TextToken, TokenCorrection, UserKnownLemma } from '../db/schema.js';
import { lemmaBookFrequencies } from './book-frequency.js';
import type { HindiStutter } from './hindi-stutters.js';
import { joinReaderSpans } from '$lib/components/reader/joined-tokens.js';
import { findHindiMerges } from './hindi-merges.js';
import type { HindiMerge } from '$lib/dictionary/hindi-merge';
import { loadHindiContextChoices, canVerifyHindiContext, contextVersion } from './hindi-context.js';

/**
 * One candidate in the disambiguation list. Set on
 * is_ambiguous=true tokens; the reader popup expands the list so
 * the user can pick the correct lemma.
 *
 * `lemmaId` is nullable on the on-disk row (the worker may have
 * surfaced a candidate it couldn't link to a dictionary entry —
 * e.g. an OOV form). The reader filters those out so only
 * resolvable picks render.
 */
export type RenderedCandidate = {
  bookFrequency?: number;
  selectedBy?: 'ai' | 'human';
  lemmaId: string;
  headword: string;
  pos: string;
  glossDefault: string | null;
  personalGloss?: string | null;
  status?: 'known' | 'learning' | 'ignored' | 'unknown';
  /** Worker-time score (higher = more confident). Surfaced in
   *  attribute form so the popup can sort or label without re-running
   *  the math client-side. */
  score: number;
  /** Morphology features the worker emitted for this candidate. */
  features: Record<string, string>;
};

/** Per-language spelled-out + ISO 15919 romanization for a
 *  digit-only NUM token. Keyed on language for symmetry with the wire
 *  shape; `or` is the ISO 639-1 code for Odia. */
export type RenderedNumberLanguageForm = {
  spelled: string;
  romanized: string;
};

export type RenderedNumberForms = {
  /** Store the digits as text so decimal values keep their precision. */
  value: string;
  digitsLatin: string;
  digitsDeva: string;
  digitsOrya: string;
  hi: RenderedNumberLanguageForm;
  mr: RenderedNumberLanguageForm;
  /** Odia rendering. Field is `odia` rather than the ISO 639-1 `or`
   *  because `or` is a reserved Python keyword on the server-side
   *  Pydantic model that emits this payload. */
  odia: RenderedNumberLanguageForm;
  /** Basque rendering. Latin script, so `romanized` is empty — the
   *  spelled-out form is already the reading. Base-20 (vigesimal). */
  eu: RenderedNumberLanguageForm;
};

export type RenderedToken = {
  ignoredHere?: boolean;
  mergeOptions?: HindiMerge[];
  confirmedMerge?: HindiMerge;
  /** Exclusive source-token end for each multiword dictionary reading starting here. */
  dictionarySpanEnds?: Record<string, number>;
  lastTokenIdx?: number;
  bookFrequency?: number;
  correctedByViewer?: boolean;
  canVerifyContext?: boolean;
  contextVersion?: string;
  selectedBy?: 'ai' | 'human';
  selectionStatus?: string;
  id: string;
  idx: number;
  /** Owning chapter id — lets the reader capture the mined sentence when a
   *  word is marked Learning (the popup posts chapterId + idx). */
  chapterId: string;
  surface: string;
  isWord: boolean;
  isAmbiguous: boolean;
  isOov: boolean;
  lemmaId: string | null;
  headword?: string;
  pos?: string;
  romanization: string | null;
  /** Canonical short gloss for the lemma — surfaced in the hover
   *  tooltip so a reader can scan a paragraph without
   *  locking the side panel. Null when the lemma has no glossDefault
   *  on file, or when the token has no lemma id (whitespace, OOV). */
  glossDefault: string | null;
  /** The viewer's own translation for this lemma, if any. Pulled
   *  from `translations` where `source = 'user'` and
   *  `submitted_by = viewerId`. Surfaced in the hover tooltip ahead
   *  of `glossDefault` so words the user has personally translated
   *  read in their own words on hover. Null for anonymous viewers
   *  and for lemmas the viewer hasn't translated. */
  personalGloss: string | null;
  /** alternate lemma candidates the worker scored. Empty
   *  array when the token has no candidates beyond the top pick
   *  (or when the worker hasn't run). The popup hides the
   *  alternate-meanings affordance when this is empty. */
  candidates: RenderedCandidate[];
  /** Morphology features on the resolved candidate (the one whose
   *  lemma the token's lemma_id points at). Stored on
   *  `text_tokens.features` at process time so the popup can show
   *  pills like "past · 1sg" without re-running Stanza or scanning
   *  the candidate list. Empty object when the worker emitted no
   *  features for this token (e.g. punctuation, OOV, the stub
   *  pipeline). */
  features: Record<string, string>;
  /** digit-only NUM tokens carry a per-language spelled-out
   *  form + romanization. Null on every other token. */
  numberForms: RenderedNumberForms | null;
  status: 'known' | 'learning' | 'ignored' | 'unknown';
  /** PDF source only: the word's normalized (0..1) bounding box on the
   *  page image; drives the image reader's clickable word hotspots.
   *  Null for text tokens and whitespace/punctuation. */
  bbox: { x: number; y: number; w: number; h: number } | null;
  /**
   * Whether the tooltip can show a definition, including one from another entry for the same
   * headword.
   */
  hasDefinition: boolean;
};

/**
 * Load every token in a chapter (in reading order) along with the
 * caller's known-status for each lemma. Returns null when no tokens
 * have been written yet — the caller (the reader page) falls back to
 * client-side whitespace tokenization in that case.
 */
export async function loadChapterTokens(
  chapterId: string,
  viewerId: string | null,
  textId?: string,
  joinStutters = true,
  sourceStartsById?: ReadonlyMap<string, number>,
): Promise<RenderedToken[] | null> {
  const tokens = (await db
    .select({
      ...getTableColumns(schema.textTokens),
      ignoredHere: viewerId ? sql<boolean>`EXISTS (
        SELECT 1 FROM reader_ignored_tokens i WHERE i.user_id=${viewerId} AND i.token_id=${schema.textTokens.id}
      )` : sql<boolean>`false`,
    })
    .from(schema.textTokens)
    .where(and(eq(schema.textTokens.chapterId, chapterId),
      sourceStartsById && inArray(schema.textTokens.id, [...sourceStartsById.keys()])))
    .orderBy(schema.textTokens.idx)) as (TextToken & { ignoredHere: boolean })[];

  if (tokens.length === 0) return null;

  // Pull the viewer's per-token corrections in one SELECT
  // so we can apply them in the same map below without a per-token
  // round trip. Anonymous viewers don't have corrections; signed-in
  // viewers usually have only a handful per chapter, so this is
  // cheap.
  const correctionsByTokenId = new Map<string, TokenCorrection>();
  if (viewerId && tokens.length > 0) {
    const corrRows = (await db
      .select()
      .from(schema.tokenCorrections)
      .where(
        and(
          eq(schema.tokenCorrections.userId, viewerId),
          inArray(schema.tokenCorrections.tokenId, sourceStartsById ? [...sourceStartsById.keys()] : sql`(
            SELECT ${schema.textTokens.id} FROM ${schema.textTokens}
            WHERE ${schema.textTokens.chapterId} = ${chapterId}
          )`),
        ),
      )) as TokenCorrection[];
    for (const r of corrRows) correctionsByTokenId.set(r.tokenId, r);
  }

  const [analysis] = await db.select({
    language: schema.texts.language,
    stale: sql<boolean>`${schema.hindiChapterAnalyses.revision} IS DISTINCT FROM
      (SELECT revision FROM hindi_dictionary_state WHERE id=1)`,
    hasHindiAnalysis: sql<boolean>`${schema.hindiChapterAnalyses.chapterId} IS NOT NULL`,
    merges: sql<HindiMerge[] | null>`${schema.hindiChapterAnalyses.stats}->'syllable_merges'`,
    stutters: sql<HindiStutter[] | null>`${schema.hindiChapterAnalyses.stats}->'stutters'`,
  })
    .from(schema.textChapters)
    .innerJoin(schema.texts, eq(schema.texts.id, schema.textChapters.textId))
    .leftJoin(schema.hindiChapterAnalyses, eq(schema.hindiChapterAnalyses.chapterId, schema.textChapters.id))
    .where(eq(schema.textChapters.id, chapterId));

  // A dictionary save can supply a headword or an attested form for words the
  // stored analysis missed. Resolve them before the normal viewer-specific joins.
  const liveMatches = new Set<string>();
  if (analysis && (analysis.stale || analysis.language !== 'hi')) {
    const language = analysis.language;
    const missing = tokens.filter((t) =>
      t.isWord && t.isOov && !t.lemmaId && !correctionsByTokenId.has(t.id),
    );
    const surfaces = [...new Set(missing.map((t) => t.surface))];
    if (surfaces.length) {
      const rows = await db.execute<{ surface: string; id: string }>(sql`
        SELECT surface,id FROM (${liveDictionaryMatches(sql`
          SELECT ${language}::language AS language, jsonb_array_elements_text(${JSON.stringify(surfaces)}::jsonb) AS surface
        `)}) matched ORDER BY surface,id`);
      const idsBySurface = new Map<string, string[]>();
      for (const { surface, id } of rows) {
        const ids = idsBySurface.get(surface) ?? [];
        ids.push(id);
        idsBySurface.set(surface, ids);
      }
      for (const t of missing) {
        const ids = idsBySurface.get(t.surface);
        if (!ids?.length) continue;
        t.lemmaId = ids[0]!;
        t.lemmaCandidates = ids.map((lemmaId) => ({ lemmaId, score: 1, features: {} }));
        t.isOov = false;
        liveMatches.add(t.id);
      }
    }
  }

  // Apply the reader's corrections before looking up definitions and learning status so both
  // describe the selected entry.
  const primaryLemmaIds = tokens
    .map((t) => {
      const c = correctionsByTokenId.get(t.id);
      if (c?.chosenLemmaId) return c.chosenLemmaId;
      return t.lemmaId;
    })
    .filter((id): id is string => !!id);
  // Also pre-fetch every lemma referenced as a CANDIDATE so
  // the popup's alternate-meanings list can render headword + POS
  // + gloss without a per-token fetch when the user expands it. The
  // candidate list is small per token (typically 2-5 entries), so
  // unioning across the chapter still hits one SELECT.
  const candidateLemmaIds: string[] = [];
  for (const t of tokens) {
    for (const c of t.lemmaCandidates) {
      if (c.lemmaId) candidateLemmaIds.push(c.lemmaId);
    }
  }
  const lemmaIds = Array.from(
    new Set([...primaryLemmaIds, ...candidateLemmaIds]),
  );

  // Anonymous viewers have no `user_known_lemmas` rows; every word
  // renders 'unknown'. We still return the tokens so they can be
  // displayed.
  const statusByLemma = new Map<string, UserKnownLemma['status']>();
  if (viewerId && lemmaIds.length > 0) {
    const rows = (await db
      .select()
      .from(schema.userKnownLemmas)
      .where(
        // Composite filter: the user's row, intersected with the
        // lemmas in this chapter. Drizzle's `and` collapses cleanly.
        eq(schema.userKnownLemmas.userId, viewerId),
      )) as UserKnownLemma[];
    // We could've combined with inArray(lemmaId, lemmaIds) at the
    // SQL level, but the index covers (user_id, status) and the
    // viewer rarely has a huge number of known lemmas — filtering
    // in memory is cheap and keeps the query simple.
    const wanted = new Set(lemmaIds);
    for (const r of rows) {
      if (wanted.has(r.lemmaId)) statusByLemma.set(r.lemmaId, r.status);
    }
  }

  // Pull each lemma's `glossDefault` so the hover tooltip can
  // surface a brief definition without a per-hover fetch. Cheap — a
  // single SELECT against an indexed primary key.
  //
  // Also pull `language` and `headword` so we can fall back
  // to a sibling lemma's gloss when the directly-linked one is empty.
  // Common case: a token tagged PROPN (because it's part of a
  // multi-word proper name) where the dictionary entry actually lives
  // under NOUN. Pre-fix the tooltip said "No translations"; post-fix
  // it shows the sibling NOUN's gloss. Mirrors the popup-side
  // fallback in `getLemmaTranslations` so both surfaces stay in sync.
  // extend the lemma fetch to include `pos` so candidate
  // entries can render headword + POS + gloss in the alternate-
  // meanings list. We re-use the same SELECT for the primary's
  // glossDefault path.
  const glossByLemma = new Map<string, string | null>();
  const lemmaMetaById = new Map<
    string,
    { language: string; headword: string; pos: string }
  >();
  const lemmaHeadwords: Array<{
    id: string;
    language: string;
    headword: string;
  }> = [];
  if (lemmaIds.length > 0) {
    const lemmaRows = (await db
      .select({
        id: schema.lemmas.id,
        language: schema.lemmas.language,
        headword: schema.lemmas.headword,
        pos: schema.lemmas.pos,
        glossDefault: schema.lemmas.glossDefault,
      })
      .from(schema.lemmas)
      .where(inArray(schema.lemmas.id, lemmaIds))) as Array<{
      id: string;
      language: string;
      headword: string;
      pos: string;
      glossDefault: string | null;
    }>;
    for (const r of lemmaRows) {
      glossByLemma.set(r.id, r.glossDefault);
      lemmaMetaById.set(r.id, {
        language: r.language,
        headword: r.headword,
        pos: r.pos,
      });
      if (!r.glossDefault && r.language !== 'hi') {
        lemmaHeadwords.push({
          id: r.id,
          language: r.language,
          headword: r.headword,
        });
      }
    }
  }

  // The viewer's own personal translations for these lemmas, so the
  // hover tooltip can show "their" gloss instead of (or alongside)
  // the dictionary one. We only need the oldest body per lemma —
  // the popup orders the personal bucket oldest-first, so picking
  // the same row here keeps the two surfaces in sync. Anonymous
  // viewers and lemmas without a personal row simply leave
  // `personalGloss` null below.
  const personalGlossByLemma = new Map<string, string>();
  if (viewerId && lemmaIds.length > 0) {
    const personalRows = (await db
      .select({
        targetId: schema.translations.targetId,
        body: schema.translations.body,
        createdAt: schema.translations.createdAt,
      })
      .from(schema.translations)
      .where(
        and(
          eq(schema.translations.targetType, 'lemma'),
          eq(schema.translations.source, 'user'),
          eq(schema.translations.submittedBy, viewerId),
          inArray(schema.translations.targetId, lemmaIds),
        ),
      )) as Array<{ targetId: string; body: string; createdAt: Date }>;
    personalRows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (const r of personalRows) {
      if (!personalGlossByLemma.has(r.targetId)) {
        personalGlossByLemma.set(r.targetId, r.body);
      }
    }
  }

  // Sibling-fallback pass: for any chapter lemma whose own gloss is
  // null, find another lemma with the same (language, headword) that
  // has a non-null gloss and use it. We bucket by (language,
  // headword) so the fallback query is one SELECT regardless of how
  // many tokens are gloss-less, and we only run it when there's
  // actually something to fix.
  if (lemmaHeadwords.length > 0) {
    const headwords = Array.from(new Set(lemmaHeadwords.map((l) => l.headword)));
    const languages = Array.from(new Set(lemmaHeadwords.map((l) => l.language)));
    const siblingRows = (await db
      .select({
        language: schema.lemmas.language,
        headword: schema.lemmas.headword,
        glossDefault: schema.lemmas.glossDefault,
      })
      .from(schema.lemmas)
      .where(
        and(
          inArray(schema.lemmas.language, languages as LanguageCode[]),
          inArray(schema.lemmas.headword, headwords),
          isNotNull(schema.lemmas.glossDefault),
        ),
      )) as Array<{
      language: string;
      headword: string;
      glossDefault: string | null;
    }>;
    const fallbackByKey = new Map<string, string>();
    for (const r of siblingRows) {
      if (!r.glossDefault) continue;
      const key = `${r.language}\t${r.headword}`;
      if (!fallbackByKey.has(key)) {
        fallbackByKey.set(key, r.glossDefault);
      }
    }
    for (const l of lemmaHeadwords) {
      const key = `${l.language}\t${l.headword}`;
      const fallback = fallbackByKey.get(key);
      if (fallback) glossByLemma.set(l.id, fallback);
    }
  }

  const choices = [...lemmaMetaById.values()].some((entry) => entry.language === 'hi')
    ? await loadHindiContextChoices(chapterId, sourceStartsById && [...sourceStartsById.values()]) : new Map();
  const canVerifyContext = analysis?.language === 'hi'
    ? await canVerifyHindiContext(chapterId, viewerId) : false;
  const bookFrequencies = textId ? await lemmaBookFrequencies(textId, lemmaIds, viewerId ?? undefined) : undefined;
  let sourceOffset = 0;
  const rendered = tokens.map<RenderedToken>((t) => {
    const choice = liveMatches.has(t.id) ? undefined : choices.get(sourceStartsById?.get(t.id) ?? sourceOffset);
    sourceOffset += [...t.surface].length;
    const selected = choice?.selectedLemmaIds.find((id: string) => t.lemmaCandidates.some((candidate) => candidate.lemmaId === id));
    // Apply the viewer's persistent correction here so the
    // chosen lemma drives every downstream concern (status colour,
    // gloss tooltip, candidate list).
    const correction = correctionsByTokenId.get(t.id) ?? null;
    const correctedLemmaId =
      correction && correction.chosenLemmaId
        ? correction.chosenLemmaId
        : selected ?? t.lemmaId;
    // mark_proper_noun / mark_foreign / mark_not_a_word: the user
    // declared this surface isn't a learnable word. Drop the lemma
    // tie + suppress is_oov / is_ambiguous so the reader stops
    // colouring it. The status maps to 'ignored' so it counts as
    // "deliberately not learning."
    const isMarkedNonWord =
      correction != null &&
      (correction.type === 'mark_proper_noun' ||
        correction.type === 'mark_foreign' ||
        correction.type === 'mark_not_a_word');
    const effectiveLemmaId = isMarkedNonWord ? null : correctedLemmaId;

    const status: RenderedToken['status'] = isMarkedNonWord
      ? 'ignored'
      : effectiveLemmaId && statusByLemma.has(effectiveLemmaId)
        ? statusByLemma.get(effectiveLemmaId)!
        : 'unknown';

    // Offer only alternatives that link to a dictionary entry and differ from the selected
    // meaning.
    const candidates: RenderedCandidate[] = [];
    const seen = new Set<string>();
    function pushCandidate(
      lemmaId: string,
      score: number,
      features: Record<string, string>,
    ) {
      if (lemmaId === effectiveLemmaId) return;
      if (seen.has(lemmaId)) return;
      const meta = lemmaMetaById.get(lemmaId);
      if (!meta) return;
      seen.add(lemmaId);
      candidates.push({
        bookFrequency: bookFrequencies?.get(lemmaId),
        selectedBy: choice?.selectedOrigins[lemmaId],
        lemmaId,
        headword: meta.headword,
        pos: meta.pos,
        glossDefault: glossByLemma.get(lemmaId) ?? null,
        personalGloss: personalGlossByLemma.get(lemmaId) ?? null,
        status: statusByLemma.get(lemmaId) ?? 'unknown',
        score,
        features,
      });
    }
    for (const c of t.lemmaCandidates) {
      if (!c.lemmaId) continue;
      pushCandidate(c.lemmaId, c.score, c.features);
    }
    // Re-introduce the worker's original primary as a candidate
    // when the viewer's correction has bumped it out — they may
    // want to revert with one tap.
    if (
      correction &&
      correction.chosenLemmaId &&
      t.lemmaId &&
      t.lemmaId !== correction.chosenLemmaId &&
      !isMarkedNonWord
    ) {
      pushCandidate(t.lemmaId, 0, {});
    }
    candidates.sort((a, b) => b.score - a.score);

    // Use the same definition for the tooltip and the marker for words missing a definition.
    const effectiveGloss = effectiveLemmaId
      ? glossByLemma.get(effectiveLemmaId) ?? null
      : null;

    const nf = t.numberForms;
    const renderedNumberForms: RenderedNumberForms | null = nf
      ? {
          value: nf.value,
          digitsLatin: nf.digits_latin,
          digitsDeva: nf.digits_deva,
          digitsOrya: nf.digits_orya,
          hi: nf.hi,
          mr: nf.mr,
          odia: nf.odia,
          // Chapters processed before Basque number support lack `eu`;
          // fall back to an empty form (only ever read for `eu` texts,
          // which are all reprocessed with this field present).
          eu: nf.eu ?? { spelled: '', romanized: '' },
        }
      : null;

    return {
      ...(correction?.chosenLemmaId && { correctedByViewer: true }),
      ...(viewerId && t.isWord && { ignoredHere: t.ignoredHere }),
      canVerifyContext: canVerifyContext && !liveMatches.has(t.id),
      contextVersion: contextVersion(t.lemmaCandidates.flatMap(c=>c.lemmaId?[c.lemmaId]:[]),choice),
      selectedBy: effectiveLemmaId ? choice?.selectedOrigins[effectiveLemmaId] : undefined,
      selectionStatus: choice?.status,
      id: t.id,
      idx: t.idx,
      chapterId,
      surface: t.surface,
      isWord: isMarkedNonWord ? false : t.isWord,
      isAmbiguous: candidates.length > 0,
      // mark_* corrections bypass OOV: the user has told us this
      // surface is a proper noun / foreign / non-word, not "missing
      // from the dictionary".
      isOov: isMarkedNonWord ? false : t.isOov,
      lemmaId: effectiveLemmaId,
      bookFrequency: effectiveLemmaId ? bookFrequencies?.get(effectiveLemmaId) : undefined,
      headword: effectiveLemmaId ? lemmaMetaById.get(effectiveLemmaId)?.headword : undefined,
      pos: effectiveLemmaId ? lemmaMetaById.get(effectiveLemmaId)?.pos : undefined,
      romanization: t.romanization,
      glossDefault: effectiveGloss,
      personalGloss: effectiveLemmaId
        ? personalGlossByLemma.get(effectiveLemmaId) ?? null
        : null,
      candidates,
      features: t.lemmaCandidates.find((candidate) => candidate.lemmaId === effectiveLemmaId)?.features ?? t.features,
      numberForms: renderedNumberForms,
      status,
      bbox: t.bbox ?? null,
      hasDefinition: effectiveGloss != null,
    };
  });
  if (!joinStutters) return rendered;
  const grouped = joinReaderSpans(rendered, [
    ...(analysis?.merges ?? []).map(m => ({ ...m, anchor: m.first })),
    ...(analysis?.stutters ?? []).filter(s => s.status === 'auto' || s.status === 'confirmed')
      .map(s => ({ first: s.first, last: s.word, anchor: s.word, surface: s.surface })),
  ]);
  if (analysis?.hasHindiAnalysis && grouped.some(t => t.features.Compound === 'Yes' ||
    t.candidates.some(c => c.features.Compound === 'Yes'))) {
    const compounds = await db.execute<{ start_idx: number; end_idx: number; lemma_id: string }>(sql`
      SELECT start_idx, max(end_idx)::int end_idx, lemma_id FROM hindi_occurrences
      WHERE chapter_id=${chapterId} AND end_idx > start_idx + 1
      GROUP BY start_idx, lemma_id`);
    const byIndex = new Map(grouped.map(t => [t.idx, t]));
    for (const match of compounds) {
      const anchor = byIndex.get(match.start_idx);
      if (anchor) (anchor.dictionarySpanEnds ??= {})[match.lemma_id] = match.end_idx;
    }
  }
  if (canVerifyContext && analysis?.hasHindiAnalysis) {
    const saved = new Map(analysis.merges?.map(m => [m.first, m]));
    for (const token of grouped) {
      const merge = saved.get(token.idx);
      if (merge?.surface === token.surface) token.confirmedMerge = merge;
    }
    const options = await findHindiMerges(db, grouped);
    if (options.length) {
      for (const t of grouped) {
        if (!t.isWord) continue;
        const matches = options.filter(m => m.first <= t.idx && t.idx <= m.last);
        if (matches.length) t.mergeOptions = matches;
      }
    }
  }
  return grouped;
}

/**
 * Bulk load known-status for a set of lemma ids — used by the
 * client-side tokenizer fallback path so even pre-worker chapters
 * can still highlight known / learning words once the user marks
 * any.
 *
 * Returns a map keyed by lemmaId. Lemmas not in the map are
 * 'unknown' by default.
 */
export async function loadKnownStatusMap(
  viewerId: string | null,
  lemmaIds: string[],
): Promise<Map<string, UserKnownLemma['status']>> {
  if (!viewerId || lemmaIds.length === 0) return new Map();
  const rows = await db.select({
    lemmaId: schema.userKnownLemmas.lemmaId,
    status: schema.userKnownLemmas.status,
  }).from(schema.userKnownLemmas).where(and(
    eq(schema.userKnownLemmas.userId, viewerId),
    inArray(schema.userKnownLemmas.lemmaId, lemmaIds),
  ));
  return new Map(rows.map((r) => [r.lemmaId, r.status]));
}

/** Rare but useful: every lemma the user has marked, regardless of
 * which chapter it appears in. Used by the stats page. */
export async function listKnownLemmas(
  viewerId: string,
  status?: UserKnownLemma['status'],
): Promise<UserKnownLemma[]> {
  const conditions = status
    ? [
        eq(schema.userKnownLemmas.userId, viewerId),
        eq(schema.userKnownLemmas.status, status),
      ]
    : [eq(schema.userKnownLemmas.userId, viewerId)];
  // Same as above — we can keep the query single-condition + filter
  // in memory if it ever becomes a hot path, but list endpoints don't
  // mind a small extra clause.
  const rows = (await db
    .select()
    .from(schema.userKnownLemmas)
    .where(
      conditions.length === 1
        ? conditions[0]!
        : (await import('drizzle-orm')).and(...conditions)!,
    )) as UserKnownLemma[];
  return rows;
}

// Re-export `inArray` so callers can build composite predicates
// without importing drizzle directly when needed.
export { inArray };

// -----------------------------------------------------------------------
// setKnownLemmaStatus
// -----------------------------------------------------------------------

/**
 * Upsert the user's known-status for a lemma. The reader's pop-up
 * wires its Learning / Known / Ignored buttons through this.
 * Recomputes the per-language known-count cache on
 * `user_languages.known_words_count_cache` so the stats card on the
 * profile page is correct without a full scan.
 *
 * Returns the new status row.
 */
export async function setKnownLemmaStatus(args: {
  userId: string;
  lemmaId: string;
  status: 'unknown' | 'learning' | 'known' | 'ignored';
  now?: Date;
  /** When set, record the sentence (and its location) the word was mined
   *  from, for the Anki export. Omit to leave any existing context intact. */
  minedSentence?: string;
  minedChapterId?: string;
  minedTokenIdx?: number;
}): Promise<UserKnownLemma> {
  const now = args.now ?? new Date();
  const minedFields =
    args.minedSentence !== undefined
      ? {
          minedSentence: args.minedSentence,
          minedChapterId: args.minedChapterId ?? null,
          minedTokenIdx: args.minedTokenIdx ?? null,
        }
      : {};

  // Look up the lemma to find its language — needed for the per-
  // language cache update. A missing lemma is a 404; the caller
  // converts the thrown error.
  const [lemma] = await db
    .select({ id: schema.lemmas.id, language: schema.lemmas.language })
    .from(schema.lemmas)
    .where(eq(schema.lemmas.id, args.lemmaId))
    .limit(1);
  if (!lemma) {
    throw new Error(`Lemma ${args.lemmaId} not found`);
  }
  const language = (lemma as { language: LanguageCode }).language;

  // Upsert. We can't use Drizzle's onConflictDoUpdate with a composite
  // PK across all our drivers without a lot of ceremony — the simpler
  // path is to read the existing row and conditionally INSERT or
  // UPDATE.
  const existing = (await db
    .select()
    .from(schema.userKnownLemmas)
    .where(eq(schema.userKnownLemmas.userId, args.userId))) as UserKnownLemma[];
  const row = existing.find((r) => r.lemmaId === args.lemmaId);

  let result: UserKnownLemma;
  if (row) {
    const [updated] = (await db
      .update(schema.userKnownLemmas)
      .set({ status: args.status, updatedAt: now })
      .where(
        // Composite PK condition.
        (await import('drizzle-orm')).and(
          eq(schema.userKnownLemmas.userId, args.userId),
          eq(schema.userKnownLemmas.lemmaId, args.lemmaId),
        )!,
      )
      .returning()) as UserKnownLemma[];
    if (!updated) throw new Error('Failed to update user_known_lemmas');
    result = updated;
  } else {
    const [inserted] = (await db
      .insert(schema.userKnownLemmas)
      .values({
        userId: args.userId,
        lemmaId: args.lemmaId,
        status: args.status,
        updatedAt: now,
      })
      .returning()) as UserKnownLemma[];
    if (!inserted) throw new Error('Failed to insert user_known_lemmas');
    result = inserted;
  }

  // Mined-sentence columns are written separately and best-effort: the core
  // status change above always succeeds, and if the `mined_*` columns don't
  // exist yet (migration 0047 not applied) this just no-ops rather than
  // failing the whole request.
  if (Object.keys(minedFields).length > 0) {
    try {
      await db
        .update(schema.userKnownLemmas)
        .set(minedFields)
        .where(
          (await import('drizzle-orm')).and(
            eq(schema.userKnownLemmas.userId, args.userId),
            eq(schema.userKnownLemmas.lemmaId, args.lemmaId),
          )!,
        );
    } catch {
      // columns missing / transient error — status is already saved
    }
  }

  // Recompute the cache for this user × language. Counted as the
  // number of rows with status='known' for the lemmas in that
  // language.
  const allKnown = (await db
    .select({
      lemmaId: schema.userKnownLemmas.lemmaId,
      language: schema.lemmas.language,
    })
    .from(schema.userKnownLemmas)
    .innerJoin(schema.lemmas, eq(schema.lemmas.id, schema.userKnownLemmas.lemmaId))
    .where(
      (await import('drizzle-orm')).and(
        eq(schema.userKnownLemmas.userId, args.userId),
        eq(schema.userKnownLemmas.status, 'known'),
        eq(schema.lemmas.language, language),
      )!,
    )) as Array<{ lemmaId: string; language: string }>;
  const knownCount = allKnown.length;
  await db
    .update(schema.userLanguages)
    .set({ knownWordsCountCache: knownCount })
    .where(
      (await import('drizzle-orm')).and(
        eq(schema.userLanguages.userId, args.userId),
        eq(schema.userLanguages.language, language),
      )!,
    );

  return result;
}
