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
import { and, eq } from 'drizzle-orm';

import { stripNukta } from '@ciareader/shared-types';

import { db, schema } from '../db/index.js';
import { nlpClient, type NlpToken } from '../nlp-client.js';
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

type LemmaIndex = {
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
};

/**
 * Pre-load every lemma in the language into a pair of lookup maps so
 * the per-token resolution is O(1) memory rather than O(n) DB
 * round-trips. For an MVP-sized lemma table (~50k Hindi entries)
 * this is a few MB of strings — well within process memory.
 */
async function loadLemmaIndex(
  language: 'hi' | 'mr' | 'or',
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
    if (!overridesBySurface.has(r.surfaceNfc)) {
      overridesBySurface.set(r.surfaceNfc, r.chosenLemmaId);
    }
  }
  return {
    byHeadwordPos,
    byHeadword,
    byNuktaStrippedHeadword,
    overridesBySurface,
  };
}

// Each MVP language has a single canonical script today (multi-script
// languages — Sindhi, Urdu — land in M15). Hardcoded here so the
// dispatcher doesn't have to drag the Python language registry in.
const SCRIPT_FOR: Record<'hi' | 'mr' | 'or', string> = {
  hi: 'Deva',
  mr: 'Deva',
  or: 'Orya',
};

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
  language: 'hi' | 'mr' | 'or',
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
      script: SCRIPT_FOR[language],
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
  language: 'hi' | 'mr' | 'or',
  index: LemmaIndex,
): Promise<string | null> {
  if (!token.is_word) return null;
  // T-2.8: digit-only surfaces (with or without comma separators)
  // get rendered as numbers in the popup, not as lemmas. Skip lemma
  // resolution + auto-create for them so the lemmas table doesn't
  // collect "1,013,322 / NUM" rows the curator has to clean up later.
  // The number_forms column on the token row carries the per-language
  // spelled-out payload that drives the popup.
  if (looksLikeNumberToken(token.surface)) return null;
  // T-2.7: form_lemma_overrides wins over Stanza. Curator seeds for
  // treebank quirks (Hindi finite copulas → होना and friends) +
  // T-6.7's crowdsourced promotions land here. The lookup is keyed
  // on surface_nfc; the dispatcher today only loads wildcard-context
  // entries — context-specific rows come online when the M6
  // disambiguation UI ships.
  const override = index.overridesBySurface.get(token.surface);
  if (override) return override;
  // Strict-POS lookup first across every candidate. Real Stanza
  // output usually hits this path.
  for (const c of token.candidates) {
    const strict = index.byHeadwordPos.get(`${c.lemma} ${c.pos}`);
    if (strict) return strict;
  }
  // Loose fallback — the stub emits `pos: 'X'` for everything, and
  // even real Stanza occasionally disagrees with the dictionary's
  // POS (e.g. participles). First lemma row matching the headword
  // wins.
  for (const c of token.candidates) {
    const loose = index.byHeadword.get(c.lemma);
    if (loose) return loose;
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
    if (stripped) return stripped;
  }
  // Last resort — auto-create a lemma row from the top candidate so
  // the user can attach translations to it. Stub-pipeline candidates
  // (`pos: 'X'`, `lemma === surface`) still create a row; T-3.7's
  // editor lets curators clean those up later.
  const top = token.candidates[0];
  if (!top || !top.lemma) return null;
  return ensureLemma(language, top, index);
}

async function processChapter(
  chapter: Pick<TextChapter, 'id' | 'body'>,
  language: 'hi' | 'mr' | 'or',
  index: LemmaIndex,
): Promise<number> {
  const result = await nlpClient.process(language, chapter.body);
  // Resolve / auto-create lemmas first so each token's lemma_id is
  // ready for the bulk insert. We can't `Promise.all` because
  // ensureLemma writes into the shared index — sequential keeps
  // duplicate inserts from racing each other across tokens of the
  // same lemma.
  const resolvedLemmaIds: Array<string | null> = [];
  for (const t of result.tokens) {
    resolvedLemmaIds.push(await pickLemmaId(t, language, index));
  }
  const rows = result.tokens.map((t, i) => {
    const lemmaId = resolvedLemmaIds[i] ?? null;
    return {
      chapterId: chapter.id,
      idx: t.idx,
      surface: t.surface,
      lemmaId,
      lemmaCandidates: t.candidates.map((c) => ({
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
      romanization: t.romanization,
      numberForms: t.number_forms ?? null,
    };
  }) satisfies Array<Omit<TextToken, 'id'>>;
  if (rows.length === 0) return 0;
  // Replace any previous tokens for idempotency (re-processing a
  // text via T-6.8 admin endpoint should overwrite, not duplicate).
  await db
    .delete(schema.textTokens)
    .where(eq(schema.textTokens.chapterId, chapter.id));
  // Postgres caps a single statement at 65534 bound parameters.
  // text_tokens has ~10 columns, so a 7000-token chapter alone
  // would blow past the cap as one INSERT. Batch.
  const BATCH = 1000;
  for (let off = 0; off < rows.length; off += BATCH) {
    await db.insert(schema.textTokens).values(rows.slice(off, off + BATCH));
  }
  return rows.length;
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
