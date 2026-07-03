/**
 * In-process NLP dispatcher (T-4.4 production wiring, dev variant).
 *
 * The plan calls for an arq worker dequeuing from Redis. Until that
 * deployment piece lands, this dispatcher does the work itself
 * inside the SvelteKit Node process: for each chapter, hit the NLP
 * service's `/process`, persist the returned tokens to
 * `text_tokens`, and flip the text status when done.
 *
 * Synchronous-feeling but fire-and-forget — the upload action
 * returns 201 right after enqueue, and this dispatcher runs in the
 * background so the user lands on /reader/[id] with status='pending'
 * → 'processing' → 'ready' as the polling endpoint reflects each
 * step.
 *
 * Lemma resolution: the NLP service returns candidates by headword
 * string (`lemma` + `pos`). For each token we try a strict
 * `(headword, pos)` match first, then fall back to a headword-only
 * lookup — useful for the stub pipeline (every candidate `pos:'X'`)
 * and real-world POS disagreements (e.g. Stanza tagging a
 * participle VERB while the dictionary stores ADJ).
 *
 * Nukta-agnostic third tier (#320): once #316 landed, the Hindi
 * pipeline emits `पढ़ना` (with nukta) for verbs whose lemmas Stanza
 * had previously been stripping. Pre-#316 `lemmas` rows were stored
 * without the nukta as `पढना`, and a strict `byHeadword` lookup
 * misses them — `ensureLemma` would mint a duplicate row and split
 * known-words tracking + translations across two lemma IDs. The
 * third tier reduces both candidate and stored headword to their
 * nukta-free form (via `stripNukta` from `@ciareader/shared-types`)
 * so the two variants collapse to the same key. This is a transition
 * aid: long-term, a one-shot dedup migration can fold pre-#316
 * duplicates into the canonical with-nukta row and the tier becomes
 * a no-op.
 */
import { and, eq, isNull } from 'drizzle-orm';

import { LANGUAGES, stripNukta, type LanguageCode } from '@ciareader/shared-types';

import { db, schema } from '../db/index.js';
import { nlpClient, type NlpToken, type ProposedPhrase } from '../nlp-client.js';
import { looksLikeNumberToken } from '$lib/components/reader/types.js';
import type {
  Lemma,
  Text,
  TextChapter,
  TextToken,
} from '../db/schema.js';
import {
  markTextFailed,
  markTextProcessing,
  markTextReady,
  type JobDispatcher,
} from './jobs.js';
import { rebuildChapterSpans } from './phrase-spans.js';
import { upsertPhraseProposals } from './phrase-proposals.js';

export type LemmaIndex = {
  /** `${headword} ${pos}` → id. Strict-POS lookup. */
  byHeadwordPos: Map<string, string>;
  /** `headword` → id (first row wins). Loose fallback. */
  byHeadword: Map<string, string>;
  /**
   * `stripNukta(headword)` → id (first row wins). #320 transition
   * tier so post-#316 candidates (`पढ़ना`) collapse onto pre-#316
   * lemma rows (`पढना`) — and vice-versa — instead of triggering
   * an auto-create. Both directions of the mismatch reduce to the
   * same nukta-free key.
   */
  byNuktaStrippedHeadword: Map<string, string>;
  /**
   * `surface_nfc` → chosen lemma id, applied BEFORE Stanza's
   * candidate is consulted (T-2.7). Curator seeds + crowdsourced
   * promotions land here. Wildcard-context (`context_signature=''`)
   * entries match any context; signature-keyed entries land later
   * once T-6.7's aggregation worker is wired.
   */
  overridesBySurface: Map<string, string>;
  /**
   * `surface` → lemma id derived from live (non-quarantined)
   * `lemma_forms` rows. Sits between the curator-context override
   * tier and Stanza's candidates: a recorded form mapping is more
   * trustworthy than a Stanza guess but less specific than a
   * context-keyed override. Pre-loaded once per chapter run, like
   * the headword tiers.
   */
  bySurface: Map<string, string>;
  /**
   * `surface` → dictionary-provided romanization from the same live
   * `lemma_forms` rows. Curators (and imports) record phonetic
   * readings here for words the rule-based romanizer gets wrong —
   * chiefly Yiddish loshn-koydesh vocabulary, where the etymological
   * spelling defeats letter mapping (שבת → shabes, not "shbs"). A
   * recorded reading beats the NLP token's rule-based output when
   * the chapter's tokens are persisted, so dictionary updates reach
   * the reader on the next (re)process.
   */
  romanizationBySurface: Map<string, string>;
};

/**
 * Case-fold key for surface-keyed lookups (overrides + lemma_forms).
 * NFC then lower-case so a sentence-initial / all-caps inflected form
 * ("Badiara", "MENDEBALERANTZ") resolves to the same paradigm/override
 * entry as its lower-case form. A no-op for case-less scripts
 * (Devanagari, Hebrew, Odia), so it only affects Latin-script languages
 * like Basque. The tiny risk — a capitalised proper noun colliding with
 * a common-noun form — is acceptable for a reader and matches the
 * intent of the existing Title-case override seeds.
 */
function foldSurface(surface: string): string {
  return surface.normalize('NFC').toLowerCase();
}

/**
 * Pre-load every lemma in the language into a pair of lookup maps so
 * the per-token resolution is O(1) memory rather than O(n) DB
 * round-trips. For an MVP-sized lemma table (~50k Hindi entries)
 * this is a few MB of strings — well within process memory.
 */
export async function loadLemmaIndex(
  language: LanguageCode,
): Promise<LemmaIndex> {
  const rows = (await db
    .select({
      id: schema.lemmas.id,
      headword: schema.lemmas.headword,
      pos: schema.lemmas.pos,
    })
    .from(schema.lemmas)
    .where(eq(schema.lemmas.language, language))) as Array<
    Pick<Lemma, 'id' | 'headword' | 'pos'>
  >;
  const byHeadwordPos = new Map<string, string>();
  const byHeadword = new Map<string, string>();
  const byNuktaStrippedHeadword = new Map<string, string>();
  for (const r of rows) {
    byHeadwordPos.set(`${r.headword} ${r.pos}`, r.id);
    if (!byHeadword.has(r.headword)) byHeadword.set(r.headword, r.id);
    // Same first-row-wins rule as `byHeadword`. We compute the
    // stripped key in JS rather than reading the Postgres-side
    // generated column (#318) so the dispatcher doesn't need a
    // schema migration for this tier — and the helper is the
    // single source of truth for the strip rule.
    const stripped = stripNukta(r.headword);
    if (!byNuktaStrippedHeadword.has(stripped)) {
      byNuktaStrippedHeadword.set(stripped, r.id);
    }
  }
  // T-2.7 overrides — pre-load every wildcard-context row for the
  // language. Signature-keyed rows (T-6.7's aggregation output)
  // would be loaded via a per-token lookup; for the MVP we only
  // ship wildcard seeds, so a single-query preload is fine.
  const overrideRows = (await db
    .select({
      surfaceNfc: schema.formLemmaOverrides.surfaceNfc,
      chosenLemmaId: schema.formLemmaOverrides.chosenLemmaId,
      contextSignature: schema.formLemmaOverrides.contextSignature,
    })
    .from(schema.formLemmaOverrides)
    .where(eq(schema.formLemmaOverrides.language, language))) as Array<{
    surfaceNfc: string;
    chosenLemmaId: string;
    contextSignature: string;
  }>;
  const overridesBySurface = new Map<string, string>();
  for (const r of overrideRows) {
    if (r.contextSignature !== '') continue; // wildcard only for now
    const key = foldSurface(r.surfaceNfc);
    if (!overridesBySurface.has(key)) {
      overridesBySurface.set(key, r.chosenLemmaId);
    }
  }
  // Live `lemma_forms` surface → lemma_id mappings for this language.
  // The filtered index `lemma_forms_surface_lookup_idx` makes this
  // load cheap and excludes quarantined junk rows automatically (the
  // index has `WHERE quarantined_at IS NULL`); we still ask for it
  // explicitly here so the planner has no excuse to use a wider scan.
  const formRows = (await db
    .select({
      surface: schema.lemmaForms.surface,
      lemmaId: schema.lemmaForms.lemmaId,
      romanization: schema.lemmaForms.romanization,
    })
    .from(schema.lemmaForms)
    .innerJoin(schema.lemmas, eq(schema.lemmas.id, schema.lemmaForms.lemmaId))
    .where(
      and(
        eq(schema.lemmas.language, language),
        isNull(schema.lemmaForms.quarantinedAt),
      ),
    )) as Array<{ surface: string; lemmaId: string; romanization: string | null }>;
  const bySurface = new Map<string, string>();
  const romanizationBySurface = new Map<string, string>();
  for (const r of formRows) {
    const key = foldSurface(r.surface);
    if (!bySurface.has(key)) bySurface.set(key, r.lemmaId);
    if (r.romanization && !romanizationBySurface.has(key)) {
      romanizationBySurface.set(key, r.romanization);
    }
  }
  return {
    byHeadwordPos,
    byHeadword,
    byNuktaStrippedHeadword,
    overridesBySurface,
    bySurface,
    romanizationBySurface,
  };
}


function lookupCandidate(
  c: { lemma: string; pos: string },
  index: LemmaIndex,
): string | null {
  return (
    index.byHeadwordPos.get(`${c.lemma} ${c.pos}`) ??
    index.byHeadword.get(c.lemma) ??
    // #320 third tier — collapse nukta variants onto the canonical
    // row regardless of which side has the nukta.
    index.byNuktaStrippedHeadword.get(stripNukta(c.lemma)) ??
    null
  );
}

/**
 * Find or auto-create a lemma row for a Stanza candidate. The
 * dispatcher calls this for every word token so unrecognized lemmas
 * (Stanza had a lemmatization but the dictionary had no row yet)
 * become real `lemmas` rows the user can attach translations to.
 *
 * The auto-created row is tagged `source='official_dictionary'` +
 * `sourceAttribution='Stanza UD'` so curators can see where it came
 * from in the dictionary editor (T-3.7) and clean up / promote it.
 * `curator_locked` stays false so a real upstream dictionary import
 * can still overwrite the auto-created entry later.
 *
 * Skips creation when the candidate's lemma is empty (punctuation /
 * symbol tokens) — those don't deserve a dictionary row.
 */
async function ensureLemma(
  language: LanguageCode,
  candidate: { lemma: string; pos: string },
  index: LemmaIndex,
): Promise<string | null> {
  const headword = candidate.lemma?.trim();
  const pos = candidate.pos?.trim() || 'X';
  if (!headword) return null;

  const existing = lookupCandidate({ lemma: headword, pos }, index);
  if (existing) return existing;

  const [row] = (await db
    .insert(schema.lemmas)
    .values({
      language,
      headword,
      pos,
      // Each MVP language has a single canonical script today (multi-
      // script languages — Sindhi, Urdu — land in M15), so the shared
      // registry's primary script is authoritative.
      script: LANGUAGES[language].script,
      source: 'official_dictionary',
      sourceAttribution: 'Stanza UD',
    })
    .returning()) as Lemma[];

  if (row) {
    cacheRow(index, headword, pos, row.id);
    return row.id;
  }

  // Concurrent insert won the race — read it back.
  const [found] = (await db
    .select()
    .from(schema.lemmas)
    .where(
      and(
        eq(schema.lemmas.language, language),
        eq(schema.lemmas.headword, headword),
        eq(schema.lemmas.pos, pos),
      ),
    )
    .limit(1)) as Lemma[];
  if (found) {
    cacheRow(index, headword, pos, found.id);
    return found.id;
  }
  return null;
}

/**
 * Refresh the in-memory lemma index after a row is inserted (or
 * read back from the DB on a race). Centralized so all three tiers
 * (#320 added the third) stay populated in lockstep — a future
 * tier addition only has to update this one helper.
 */
function cacheRow(
  index: LemmaIndex,
  headword: string,
  pos: string,
  id: string,
): void {
  index.byHeadwordPos.set(`${headword} ${pos}`, id);
  if (!index.byHeadword.has(headword)) {
    index.byHeadword.set(headword, id);
  }
  const stripped = stripNukta(headword);
  if (!index.byNuktaStrippedHeadword.has(stripped)) {
    index.byNuktaStrippedHeadword.set(stripped, id);
  }
}

async function pickLemmaId(
  token: NlpToken,
  language: LanguageCode,
  index: LemmaIndex,
): Promise<{ lemmaId: string | null; viaSurfaceMap: boolean }> {
  if (!token.is_word) return { lemmaId: null, viaSurfaceMap: false };
  // T-2.8: digit-only surfaces (with or without comma separators)
  // get rendered as numbers in the popup, not as lemmas. Skip lemma
  // resolution + auto-create for them so the lemmas table doesn't
  // collect "1,013,322 / NUM" rows the curator has to clean up later.
  // The number_forms column on the token row carries the per-language
  // spelled-out payload that drives the popup.
  if (looksLikeNumberToken(token.surface))
    return { lemmaId: null, viaSurfaceMap: false };
  // T-2.7: form_lemma_overrides wins over Stanza. Curator seeds for
  // treebank quirks (Hindi finite copulas → होना and friends) +
  // T-6.7's crowdsourced promotions land here. The lookup is keyed
  // on surface_nfc; the dispatcher today only loads wildcard-context
  // entries — context-specific rows come online when the M6
  // disambiguation UI ships.
  const override = index.overridesBySurface.get(foldSurface(token.surface));
  if (override) return { lemmaId: override, viaSurfaceMap: true };
  // `lemma_forms` surface tier. A recorded inflected form (curator-
  // added or paradigm-generated, with quarantined junk filtered out)
  // resolves the surface directly to its parent lemma — beats
  // Stanza's candidate guesses because the form-table mapping has
  // already been vetted (or generated from a paradigm a curator
  // signed off on). Sits below the context-aware override tier
  // because that one can encode "this surface in *this* sentence
  // means X" while this one is unconditional.
  const fromForms = index.bySurface.get(foldSurface(token.surface));
  if (fromForms) return { lemmaId: fromForms, viaSurfaceMap: true };
  // Strict-POS lookup first across every candidate. Real Stanza
  // output usually hits this path.
  for (const c of token.candidates) {
    const strict = index.byHeadwordPos.get(`${c.lemma} ${c.pos}`);
    if (strict) return { lemmaId: strict, viaSurfaceMap: false };
  }
  // Loose fallback — the stub emits `pos: 'X'` for everything, and
  // even real Stanza occasionally disagrees with the dictionary's
  // POS (e.g. participles). First lemma row matching the headword
  // wins.
  for (const c of token.candidates) {
    const loose = index.byHeadword.get(c.lemma);
    if (loose) return { lemmaId: loose, viaSurfaceMap: false };
  }
  // #320 nukta-stripped fallback. Catches the post-#316 / pre-#316
  // mismatch where the candidate's headword has nuktas the stored
  // row lacks (e.g. candidate `पढ़ना` against pre-fix `पढना`), or
  // the inverse. Both reduce to the same nukta-free key. Done as a
  // separate pass so the strict-POS and loose-headword tiers above
  // always win when they could — the stripped tier is intentionally
  // lossy (`ज़रा` and `जरा` collapse) so it goes last.
  for (const c of token.candidates) {
    const stripped = index.byNuktaStrippedHeadword.get(stripNukta(c.lemma));
    if (stripped) return { lemmaId: stripped, viaSurfaceMap: false };
  }
  // Last resort — auto-create a lemma row from the top candidate so
  // the user can attach translations to it. Stub-pipeline candidates
  // (`pos: 'X'`, `lemma === surface`) still create a row; T-3.7's
  // editor lets curators clean those up later.
  const top = token.candidates[0];
  if (!top || !top.lemma) return { lemmaId: null, viaSurfaceMap: false };
  return { lemmaId: await ensureLemma(language, top, index), viaSurfaceMap: false };
}

/**
 * Resolve lemmas for a chapter's tokens and persist them, then rebuild
 * phrase spans + proposals. Shared by the text pipeline (tokens from
 * `nlpClient.process`) and the PDF pipeline (tokens from `nlpClient.ocr`,
 * each carrying a `bbox`). Idempotent: replaces any existing tokens for
 * the chapter so a re-process / re-OCR overwrites rather than duplicates.
 *
 * `tokens` is the NLP token shape with an optional `bbox` — null/absent
 * for text chapters, a normalized box for PDF page words.
 */
export async function persistTokens(args: {
  chapterId: string;
  language: LanguageCode;
  index: LemmaIndex;
  tokens: Array<
    NlpToken & { bbox?: { x: number; y: number; w: number; h: number } | null }
  >;
  proposedPhrases?: ProposedPhrase[];
}): Promise<number> {
  const { chapterId, language, index, tokens } = args;
  // Resolve / auto-create lemmas first so each token's lemma_id is
  // ready for the bulk insert. We can't `Promise.all` because
  // ensureLemma writes into the shared index — sequential keeps
  // duplicate inserts from racing each other across tokens of the
  // same lemma.
  const resolved: Array<{ lemmaId: string | null; viaSurfaceMap: boolean }> = [];
  for (const t of tokens) {
    resolved.push(await pickLemmaId(t, language, index));
  }
  const rows = tokens.map((t, i) => {
    const { lemmaId: resolvedLemmaId, viaSurfaceMap } = resolved[i]!;
    const lemmaId = resolvedLemmaId ?? null;
    return {
      chapterId,
      idx: t.idx,
      surface: t.surface,
      lemmaId,
      // T-2.7: when a surface-level override (or a vetted lemma_forms
      // mapping) resolved the lemma, Stanza's discarded guess must not
      // linger as an alternate candidate — it would render as a bogus
      // second tab in the reader popup (e.g. `arrastiko` shown next to
      // the override's `arrasti`). Collapse candidates to the resolved
      // lemma; tokens.ts drops the entry equal to the active lemma, so
      // the popup shows a single term.
      lemmaCandidates:
        viaSurfaceMap && lemmaId
          ? [{ lemmaId, features: t.candidates[0]?.features ?? {}, score: 1 }]
          : t.candidates.map((c) => ({
              lemmaId: lookupCandidate(c, index),
              features: c.features,
              score: c.score,
            })),
      features: t.candidates[0]?.features ?? {},
      isAmbiguous: t.is_ambiguous,
      // If we resolved (or auto-created) a dictionary row, the token
      // is no longer "no dictionary match" — even if Stanza initially
      // flagged it OOV because lemma==surface. The reader's "No
      // dictionary match" copy + dashed-underline is reserved for
      // tokens that genuinely have no lemma row to attach to.
      isOov: lemmaId ? false : t.is_oov,
      isWord: t.is_word,
      sentenceIdx: 0,
      // Dictionary-recorded phonetic reading wins over the pipeline's
      // rule-based romanization (see LemmaIndex.romanizationBySurface).
      romanization: index.romanizationBySurface.get(foldSurface(t.surface)) ?? t.romanization,
      numberForms: t.number_forms ?? null,
      // PDF source only — normalized word box on the page image. Null
      // for text chapters and for whitespace/punctuation.
      bbox: t.bbox ?? null,
    };
  }) satisfies Array<Omit<TextToken, 'id'>>;
  // Replace any previous tokens for idempotency (re-processing a text
  // via T-6.8 admin endpoint, or re-OCR of a PDF page, should overwrite
  // not duplicate). Always delete first — even when the new token list
  // is empty (a blank PDF page) — so stale rows don't survive.
  await db
    .delete(schema.textTokens)
    .where(eq(schema.textTokens.chapterId, chapterId));
  // Postgres caps a single statement at 65534 bound parameters.
  // text_tokens has ~11 columns, so a 7000-token chapter alone
  // would blow past the cap as one INSERT. Batch.
  const BATCH = 1000;
  for (let off = 0; off < rows.length; off += BATCH) {
    await db.insert(schema.textTokens).values(rows.slice(off, off + BATCH));
  }
  // T-14.2: rebuild `phrase_chapter_spans` now that the chapter's
  // text_tokens are in place. Failures bubble up so a span-resolver
  // crash flips the text to 'failed' rather than leaving it
  // half-indexed.
  await rebuildChapterSpans({ chapterId, language });
  // T-14.5a: persist any rule-based phrase proposals the NLP
  // service emitted. Older NLP service builds may omit
  // `proposed_phrases` — we default to an empty list so a stale
  // service version still produces correct (just emptier) data.
  // The upsert is idempotent on `(chapter_id, surface_normalised,
  // pattern_id)` so a re-process of the same chapter doesn't
  // duplicate.
  const proposals = args.proposedPhrases ?? [];
  if (proposals.length > 0) {
    await upsertPhraseProposals({ chapterId, language, proposals });
  }
  return rows.length;
}

async function processChapter(
  chapter: Pick<TextChapter, 'id' | 'body'>,
  language: LanguageCode,
  index: LemmaIndex,
): Promise<number> {
  const result = await nlpClient.process(language, chapter.body);
  return persistTokens({
    chapterId: chapter.id,
    language,
    index,
    tokens: result.tokens,
    proposedPhrases: result.proposed_phrases,
  });
}

/**
 * Run the full process flow for one text in the foreground. Returns
 * the count of tokens written, or throws if any chapter fails.
 *
 * Exported for tests + the admin re-process endpoint (T-6.8).
 */
export async function processTextNow(textId: string): Promise<number> {
  const [text] = (await db
    .select()
    .from(schema.texts)
    .where(eq(schema.texts.id, textId))
    .limit(1)) as Text[];
  if (!text) throw new Error(`Text ${textId} not found`);
  const chapters = (await db
    .select({ id: schema.textChapters.id, body: schema.textChapters.body })
    .from(schema.textChapters)
    .where(eq(schema.textChapters.textId, textId))
    .orderBy(schema.textChapters.idx)) as Array<Pick<TextChapter, 'id' | 'body'>>;

  await markTextProcessing(text.id);
  try {
    const index = await loadLemmaIndex(text.language);
    let total = 0;
    for (const chapter of chapters) {
      total += await processChapter(chapter, text.language, index);
    }
    await markTextReady(text.id);
    return total;
  } catch (e) {
    const message = (e as Error).message ?? String(e);
    await markTextFailed(text.id, message);
    throw e;
  }
}

/**
 * Background-fire dispatcher. Drops the work onto a microtask so the
 * caller (the upload action) doesn't wait for NLP — the user sees
 * the redirect-to-reader immediately and the status badge polls
 * itself ready.
 */
export const inProcessDispatcher: JobDispatcher = {
  async dispatch({ textId }) {
    // Don't await — fire-and-forget. The polling endpoint will pick
    // up the status flips. We `void` the promise but log any
    // rejection so the user doesn't get a silent stuck-pending.
    queueMicrotask(() => {
      processTextNow(textId).catch((e) => {
        console.error(`[nlp] process ${textId} failed:`, e);
      });
    });
  },
};

export { and };
