// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Call =
  | { kind: 'select' }
  | { kind: 'update'; set?: unknown }
  | { kind: 'insert'; values?: unknown }
  | { kind: 'delete' };
const calls: Call[] = [];
const staged: Array<unknown[]> = [];
function stage(rows: unknown[]) {
  staged.push(rows);
}
function nextStaged(): unknown[] {
  const v = staged.shift();
  if (!v) throw new Error('Test bug: no staged result available');
  return v;
}

function makeSelectChain() {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  // innerJoin / leftJoin land on the chain alongside `where` so the
  // dispatcher's `lemma_forms ⋈ lemmas` surface preload can run
  // against the same mock seam.
  chain.innerJoin = vi.fn(() => chain);
  chain.leftJoin = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) => resolve(nextStaged());
  return chain;
}
function makeUpdateChain() {
  const entry: Call = { kind: 'update' };
  calls.push(entry);
  const chain: Record<string, unknown> = {};
  chain.set = vi.fn((v: unknown) => {
    entry.set = v;
    return chain;
  });
  chain.where = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) => resolve(undefined);
  return chain;
}
function makeInsertChain() {
  const entry: Call = { kind: 'insert' };
  calls.push(entry);
  const chain: Record<string, unknown> = {};
  chain.values = vi.fn((v: unknown) => {
    entry.values = v;
    return chain;
  });
  // ensureLemma() chains on these for upsert-style auto-create.
  chain.onConflictDoNothing = vi.fn(() => chain);
  chain.returning = vi.fn(() => nextStaged());
  chain.then = (resolve: (v: unknown) => unknown) => resolve(undefined);
  return chain;
}
function makeDeleteChain() {
  calls.push({ kind: 'delete' });
  const chain: Record<string, unknown> = {};
  chain.where = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) => resolve(undefined);
  return chain;
}

const selectFn = vi.fn(() => {
  calls.push({ kind: 'select' });
  return makeSelectChain();
});
const updateFn = vi.fn(() => makeUpdateChain());
const insertFn = vi.fn(() => makeInsertChain());
const deleteFn = vi.fn(() => makeDeleteChain());

vi.mock('../db/index.js', () => ({
  db: {
    select: () => selectFn(),
    update: () => updateFn(),
    insert: () => insertFn(),
    delete: () => deleteFn(),
  },
  schema: {
    texts: { id: 'texts.id' },
    textChapters: { id: 'text_chapters.id', textId: 'text_chapters.text_id', idx: 'text_chapters.idx' },
    textTokens: {
      id: 'text_tokens.id',
      chapterId: 'text_tokens.chapter_id',
    },
    nlpJobs: { id: 'nlp_jobs.id', textId: 'nlp_jobs.text_id', status: 'nlp_jobs.status' },
    lemmas: { id: 'lemmas.id', headword: 'lemmas.headword', pos: 'lemmas.pos', language: 'lemmas.language' },
    formLemmaOverrides: {
      surfaceNfc: 'form_lemma_overrides.surface_nfc',
      chosenLemmaId: 'form_lemma_overrides.chosen_lemma_id',
      contextSignature: 'form_lemma_overrides.context_signature',
      language: 'form_lemma_overrides.language',
    },
    lemmaForms: {
      surface: 'lemma_forms.surface',
      lemmaId: 'lemma_forms.lemma_id',
      romanization: 'lemma_forms.romanization',
      quarantinedAt: 'lemma_forms.quarantined_at',
    },
  },
}));

const nlpProcess = vi.fn();
vi.mock('../nlp-client.js', () => ({
  nlpClient: { process: (...a: unknown[]) => nlpProcess(...a) },
}));

// T-14.2: stub the phrase-span resolver so existing dispatcher
// tests don't have to stage extra DB calls. The hook itself is
// covered by `phrase-spans.test.ts` (rebuild + loader) and the
// `'rebuilds chapter phrase spans after writing text_tokens'` case
// at the bottom of this file.
const rebuildChapterSpans = vi.fn();
vi.mock('./phrase-spans.js', () => ({
  rebuildChapterSpans: (...a: unknown[]) => rebuildChapterSpans(...a),
}));

// T-14.5a: stub the phrase-proposals queue write. The hook is
// covered by `phrase-proposals.test.ts`; this fake is just so
// existing dispatcher tests don't have to stage extra DB calls.
const upsertPhraseProposals = vi.fn();
vi.mock('./phrase-proposals.js', () => ({
  upsertPhraseProposals: (...a: unknown[]) => upsertPhraseProposals(...a),
}));

const { processTextNow } = await import('./in-process-dispatcher.js');

beforeEach(() => {
  calls.length = 0;
  staged.length = 0;
  selectFn.mockClear();
  updateFn.mockClear();
  insertFn.mockClear();
  deleteFn.mockClear();
  nlpProcess.mockReset();
  rebuildChapterSpans.mockReset();
  rebuildChapterSpans.mockResolvedValue(0);
  upsertPhraseProposals.mockReset();
  upsertPhraseProposals.mockResolvedValue(0);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('processTextNow', () => {
  it('runs each chapter through NLP, persists tokens, and marks ready', async () => {
    // text lookup
    stage([{ id: 'text-1', language: 'hi' }]);
    // chapters
    stage([
      { id: 'chap-1', body: 'one' },
      { id: 'chap-2', body: 'two' },
    ]);
    // markTextProcessing — the helper does its own SELECT-less updates
    // so no extra stages needed for the mark-* calls; they only run
    // updates which our mock returns void from.

    // lemma map preload
    stage([
      { id: 'lemma-bolnaa', headword: 'बोलना', pos: 'verb' },
    ]);
    // form_lemma_overrides preload (T-2.7) — empty for this test.
    stage([]);
    stage([]); // lemma_forms surface preload — empty for this test.

    nlpProcess.mockResolvedValueOnce({
      language: 'hi',
      pipeline_id: 'hi/stub',
      tokens: [
        {
          idx: 0,
          surface: 'बोलना',
          is_word: true,
          is_ambiguous: false,
          is_oov: false,
          romanization: 'bolnā',
          number_forms: {
            value: '123',
            digits_latin: '123',
            digits_deva: '१२३',
            digits_orya: '୧୨୩',
            hi: { spelled: 'एक सौ तेईस', romanized: 'ek sau teīs' },
            mr: { spelled: 'एकशे तेवीस', romanized: 'ēkaśē tēvīsa' },
            odia: { spelled: 'ଏକ ଶହ ତେଇଶ', romanized: 'ēka śaha tēiśa' },
          },
          candidates: [
            { lemma: 'बोलना', pos: 'verb', score: 0.9, features: { Tense: 'Pres' } },
          ],
        },
      ],
    });
    nlpProcess.mockResolvedValueOnce({
      language: 'hi',
      pipeline_id: 'hi/stub',
      tokens: [
        {
          idx: 0,
          surface: 'unknown',
          is_word: true,
          is_ambiguous: false,
          is_oov: true,
          romanization: null,
          candidates: [],
          number_forms: null,
        },
      ],
    });

    const total = await processTextNow('text-1');
    expect(total).toBe(2);

    const inserts = calls.filter((c) => c.kind === 'insert');
    // Two insert calls: one per chapter's tokens.
    expect(inserts).toHaveLength(2);
    const firstInsert = (inserts[0] as Extract<Call, { kind: 'insert' }>).values as Array<{
      lemmaId: string | null;
      surface: string;
      romanization: string | null;
      numberForms: { value: string } | null;
    }>;
    expect(firstInsert[0]!.lemmaId).toBe('lemma-bolnaa');
    expect(firstInsert[0]!.romanization).toBe('bolnā');
    expect(firstInsert[0]!.numberForms?.value).toBe('123');

    const secondInsert = (inserts[1] as Extract<Call, { kind: 'insert' }>).values as Array<{
      lemmaId: string | null;
      isOov: boolean;
      numberForms: unknown;
    }>;
    expect(secondInsert[0]!.lemmaId).toBeNull();
    expect(secondInsert[0]!.isOov).toBe(true);
    expect(secondInsert[0]!.numberForms).toBeNull();

    // Two delete calls (one per chapter, idempotency clear before insert).
    expect(calls.filter((c) => c.kind === 'delete')).toHaveLength(2);
  });

  it('auto-creates a lemma row when Stanza returns an unrecognized headword', async () => {
    // text + chapters + empty lemma index
    stage([{ id: 'text-1', language: 'hi' }]);
    stage([{ id: 'chap-1', body: 'unfamiliar word' }]);
    stage([]); // lemma index — no rows
    stage([]); // form_lemma_overrides — no rows
    stage([]); // lemma_forms surface preload — empty for this test.
    // ensureLemma's onConflictDoNothing(...).returning() chain
    // pulls one staged row.
    stage([{ id: 'lemma-new', headword: 'नमस्ते', pos: 'INTJ' }]);

    nlpProcess.mockResolvedValueOnce({
      language: 'hi',
      pipeline_id: 'stanza-hi',
      tokens: [
        {
          idx: 0,
          surface: 'नमस्ते',
          is_word: true,
          is_ambiguous: false,
          // Stanza's OOV heuristic flags `lemma==surface` as OOV; the
          // dispatcher should still auto-create + flip isOov=false
          // because we now have a dictionary row to attach to.
          is_oov: true,
          romanization: 'namaste',
          candidates: [
            { lemma: 'नमस्ते', pos: 'INTJ', score: 1.0, features: {} },
          ],
        },
      ],
    });

    await processTextNow('text-1');

    // First insert is the auto-created lemma row (ensureLemma); second
    // is the text_tokens batch.
    const inserts = calls.filter(
      (c): c is Extract<Call, { kind: 'insert' }> => c.kind === 'insert',
    );
    expect(inserts).toHaveLength(2);
    expect(inserts[0]!.values).toMatchObject({
      language: 'hi',
      headword: 'नमस्ते',
      pos: 'INTJ',
      script: 'Deva',
      sourceAttribution: 'Stanza UD',
    });
    const tokenInsert = inserts[1]!.values as Array<{
      lemmaId: string | null;
      isOov: boolean;
    }>;
    expect(tokenInsert[0]!.lemmaId).toBe('lemma-new');
    // Token had is_oov=true from the worker, but the auto-created
    // lemma row makes "no dictionary match" no longer correct.
    expect(tokenInsert[0]!.isOov).toBe(false);
  });

  it('honors a form_lemma_overrides row over the Stanza candidate (T-2.7)', async () => {
    stage([{ id: 'text-1', language: 'hi' }]);
    stage([{ id: 'chap-1', body: 'वह है।' }]);
    // lemma index: होना already exists in the dictionary.
    stage([{ id: 'lemma-hona', headword: 'होना', pos: 'VERB' }]);
    // form_lemma_overrides: surface 'है' → lemma-hona, wildcard ctx.
    stage([
      {
        surfaceNfc: 'है',
        chosenLemmaId: 'lemma-hona',
        contextSignature: '',
      },
    ]);
    stage([]); // lemma_forms surface preload — empty for this test.

    nlpProcess.mockResolvedValueOnce({
      language: 'hi',
      pipeline_id: 'stanza-hi',
      tokens: [
        {
          idx: 0,
          surface: 'है',
          is_word: true,
          is_ambiguous: false,
          is_oov: false,
          romanization: 'hai',
          // Stanza's wrong guess: lemmatizes finite copula to itself.
          candidates: [
            { lemma: 'है', pos: 'AUX', score: 1.0, features: {} },
          ],
        },
      ],
    });

    await processTextNow('text-1');

    const inserts = calls.filter(
      (c): c is Extract<Call, { kind: 'insert' }> => c.kind === 'insert',
    );
    // No lemma auto-create — the override winning skips ensureLemma.
    // Only insert is the text_tokens batch.
    expect(inserts).toHaveLength(1);
    const tokenInsert = inserts[0]!.values as Array<{
      lemmaId: string | null;
      surface: string;
    }>;
    // The token's lemma_id is the override target, not Stanza's
    // self-lemmatization.
    expect(tokenInsert[0]!.lemmaId).toBe('lemma-hona');
    expect(tokenInsert[0]!.surface).toBe('है');
  });

  it('resolves a surface via the lemma_forms tier when Stanza guesses a wrong lemma', async () => {
    // The dispatcher's new tier: a recorded `lemma_forms.surface →
    // lemma_id` mapping wins over Stanza's per-candidate lemma
    // guesses (but loses to the context-aware overrides tier above
    // it). Here Stanza emits the wrong base form for an inflected
    // surface — without the surface tier we'd auto-create a junk
    // lemma. With the tier, the recorded form mapping resolves to
    // the parent lemma instead.
    stage([{ id: 'text-1', language: 'or' }]);
    stage([{ id: 'chap-1', body: 'ମୁଁ ଘରେ ରହିଲି।' }]);
    stage([{ id: 'lemma-rahiba', headword: 'ରହିବା', pos: 'VERB' }]);
    stage([]); // overrides — empty
    stage([
      { surface: 'ରହିଲି', lemmaId: 'lemma-rahiba' },
    ]);

    nlpProcess.mockResolvedValueOnce({
      language: 'or',
      pipeline_id: 'stanza-or',
      tokens: [
        {
          idx: 0,
          surface: 'ରହିଲି',
          is_word: true,
          is_ambiguous: false,
          is_oov: false,
          romanization: 'rahili',
          number_forms: null,
          // Stanza's wrong guess: bare surface, no real lemma.
          candidates: [
            { lemma: 'ରହିଲି', pos: 'VERB', score: 1.0, features: { Tense: 'Past' } },
          ],
        },
      ],
    });

    await processTextNow('text-1');

    const inserts = calls.filter(
      (c): c is Extract<Call, { kind: 'insert' }> => c.kind === 'insert',
    );
    // No auto-create — the surface tier matched ahead of ensureLemma.
    expect(inserts).toHaveLength(1);
    const tokenInsert = inserts[0]!.values as Array<{ lemmaId: string | null; surface: string }>;
    expect(tokenInsert[0]!.lemmaId).toBe('lemma-rahiba');
    expect(tokenInsert[0]!.surface).toBe('ରହିଲି');
  });

  it('prefers a dictionary-recorded romanization over the pipeline output', async () => {
    // Yiddish loshn-koydesh: the NLP service's rule-based romanizer
    // reads שבת letter-by-letter ("shbs"); a curator recorded the
    // phonetic reading on the lemma_forms row. The recorded reading
    // must land on the persisted token so dictionary updates reach
    // the reader on the next (re)process.
    stage([{ id: 'text-1', language: 'yi' }]);
    stage([{ id: 'chap-1', body: 'שבת' }]);
    stage([{ id: 'lemma-shabes', headword: 'שבת', pos: 'NOUN' }]);
    stage([]); // overrides — empty
    stage([{ surface: 'שבת', lemmaId: 'lemma-shabes', romanization: 'shabes' }]);

    nlpProcess.mockResolvedValueOnce({
      language: 'yi',
      pipeline_id: 'custom-yi',
      tokens: [
        {
          idx: 0,
          surface: 'שבת',
          is_word: true,
          is_ambiguous: false,
          is_oov: false,
          romanization: 'shbs',
          number_forms: null,
          candidates: [{ lemma: 'שבת', pos: 'NOUN', score: 1.0, features: {} }],
        },
      ],
    });

    await processTextNow('text-1');

    const inserts = calls.filter(
      (c): c is Extract<Call, { kind: 'insert' }> => c.kind === 'insert',
    );
    expect(inserts).toHaveLength(1);
    const tokenInsert = inserts[0]!.values as Array<{
      surface: string;
      romanization: string | null;
    }>;
    expect(tokenInsert[0]!.surface).toBe('שבת');
    expect(tokenInsert[0]!.romanization).toBe('shabes');
  });

  it('does not auto-create a lemma row for digit-only number tokens (T-2.8)', async () => {
    // Stanza tags "1,013,322" as NUM with lemma=surface. Without the
    // looksLikeNumberToken short-circuit, ensureLemma would write a
    // "1,013,322 / NUM" row to the lemmas table, and the popup would
    // pull that row instead of (or in addition to) the spelled-out
    // number_forms payload — which is what triggered the user-visible
    // "Lemma 1013,3" bug. The dispatcher must skip lemma resolution
    // for this surface and leave lemma_id null.
    stage([{ id: 'text-1', language: 'hi' }]);
    stage([{ id: 'chap-1', body: 'about 1,013,322 people' }]);
    stage([]); // empty lemma index
    stage([]); // empty overrides
    stage([]); // lemma_forms surface preload — empty for this test.

    nlpProcess.mockResolvedValueOnce({
      language: 'hi',
      pipeline_id: 'stanza-hi',
      tokens: [
        {
          idx: 0,
          surface: '1,013,322',
          is_word: true,
          is_ambiguous: false,
          is_oov: false,
          romanization: '1,013,322',
          number_forms: {
            value: '1013322',
            digits_latin: '1,013,322',
            digits_deva: '१,०१३,३२२',
            digits_orya: '୧,୦୧୩,୩୨୨',
            hi: { spelled: 'दस लाख तेरह हज़ार तीन सौ बाईस', romanized: 'das lākh terah hazār tīn sau bāīs' },
            mr: { spelled: 'दहा लाख तेरा हजार तीनशे बावीस', romanized: 'dahā lākha tērā hajāra tīnaśē bāvīsa' },
            odia: { spelled: 'ଦଶ ଲକ୍ଷ ତେର ହଜାର ତିନି ଶହ ବାଇଶ', romanized: 'daśa lakṣa tēra hajāra tini śaha bāiśa' },
          },
          candidates: [
            { lemma: '1,013,322', pos: 'NUM', score: 1.0, features: {} },
          ],
        },
      ],
    });

    await processTextNow('text-1');

    const inserts = calls.filter(
      (c): c is Extract<Call, { kind: 'insert' }> => c.kind === 'insert',
    );
    // Just the text_tokens batch — no auto-created lemma row.
    expect(inserts).toHaveLength(1);
    const tokenInsert = inserts[0]!.values as Array<{
      lemmaId: string | null;
      surface: string;
      numberForms: { value: string } | null;
    }>;
    expect(tokenInsert[0]!.lemmaId).toBeNull();
    expect(tokenInsert[0]!.surface).toBe('1,013,322');
    expect(tokenInsert[0]!.numberForms?.value).toBe('1013322');
  });

  it('resolves a post-#316 nukta candidate onto an existing pre-#316 lemma row (#320)', async () => {
    // The transition scenario: the lemmas table has an old `पढना`
    // (no nukta) row from before the lemma-restoration fix.
    // Post-fix, the NLP pipeline emits `पढ़ना` (with nukta) as the
    // candidate. Without the third tier the dispatcher would
    // mint a duplicate row and split known-words tracking.
    stage([{ id: 'text-1', language: 'hi' }]);
    stage([{ id: 'chap-1', body: 'वह पढ़ती है।' }]);
    // lemma index: only the pre-#316 row exists.
    stage([{ id: 'lemma-padhna-old', headword: 'पढना', pos: 'VERB' }]);
    stage([]); // form_lemma_overrides
    stage([]); // lemma_forms surface preload — empty for this test.

    nlpProcess.mockResolvedValueOnce({
      language: 'hi',
      pipeline_id: 'stanza-hi',
      tokens: [
        {
          idx: 0,
          surface: 'पढ़ती',
          is_word: true,
          is_ambiguous: false,
          is_oov: false,
          romanization: 'paṛhtī',
          // Post-#316 lemma carries the nukta — strict-POS and
          // loose-headword tiers both miss the `पढना` row; the
          // nukta-stripped tier catches it.
          candidates: [
            { lemma: 'पढ़ना', pos: 'VERB', score: 1.0, features: {} },
          ],
        },
      ],
    });

    await processTextNow('text-1');

    const inserts = calls.filter(
      (c): c is Extract<Call, { kind: 'insert' }> => c.kind === 'insert',
    );
    // One insert: the text_tokens batch. No ensureLemma path —
    // the third tier already had the answer.
    expect(inserts).toHaveLength(1);
    const tokenInsert = inserts[0]!.values as Array<{
      lemmaId: string | null;
      surface: string;
    }>;
    expect(tokenInsert[0]!.lemmaId).toBe('lemma-padhna-old');
  });

  it('resolves a pre-#316 nukta-free candidate onto an existing canonical lemma row (#320)', async () => {
    // Inverse: lemma table has the canonical `पढ़ना` row, but the
    // candidate this run produced lacks the nukta (could be a
    // legacy text re-process after the fix landed but before the
    // pipeline was rolled out, or a fallback path elsewhere). Same
    // tier collapse — third tier matches both directions.
    stage([{ id: 'text-1', language: 'hi' }]);
    stage([{ id: 'chap-1', body: 'पढती है।' }]);
    stage([{ id: 'lemma-padhna-canon', headword: 'पढ़ना', pos: 'VERB' }]);
    stage([]); // overrides
    stage([]); // lemma_forms surface preload — empty for this test.

    nlpProcess.mockResolvedValueOnce({
      language: 'hi',
      pipeline_id: 'stanza-hi',
      tokens: [
        {
          idx: 0,
          surface: 'पढती',
          is_word: true,
          is_ambiguous: false,
          is_oov: false,
          romanization: 'paṛhtī',
          candidates: [
            { lemma: 'पढना', pos: 'VERB', score: 1.0, features: {} },
          ],
        },
      ],
    });

    await processTextNow('text-1');

    const inserts = calls.filter(
      (c): c is Extract<Call, { kind: 'insert' }> => c.kind === 'insert',
    );
    expect(inserts).toHaveLength(1);
    const tokenInsert = inserts[0]!.values as Array<{
      lemmaId: string | null;
    }>;
    expect(tokenInsert[0]!.lemmaId).toBe('lemma-padhna-canon');
  });

  it('still prefers a strict-POS match over the nukta-stripped tier (#320)', async () => {
    // Both rows are loaded: one nukta-free `पढना VERB` and one
    // canonical `पढ़ना VERB`. A candidate that exactly matches the
    // canonical row's `headword` + `pos` should resolve to it via
    // the strict tier — the third tier's lossy collapse mustn't
    // shadow an exact win.
    stage([{ id: 'text-1', language: 'hi' }]);
    stage([{ id: 'chap-1', body: 'वह पढ़ती है।' }]);
    stage([
      // Insertion order: nukta-free first. The third-tier map
      // would key both `पढना` and `पढ़ना` to the same stripped
      // string `पढना` — first-row-wins means the legacy row
      // would win the third-tier lookup. The strict tier must
      // beat that for the canonical candidate.
      { id: 'lemma-padhna-old', headword: 'पढना', pos: 'VERB' },
      { id: 'lemma-padhna-canon', headword: 'पढ़ना', pos: 'VERB' },
    ]);
    stage([]); // overrides
    stage([]); // lemma_forms surface preload — empty for this test.

    nlpProcess.mockResolvedValueOnce({
      language: 'hi',
      pipeline_id: 'stanza-hi',
      tokens: [
        {
          idx: 0,
          surface: 'पढ़ती',
          is_word: true,
          is_ambiguous: false,
          is_oov: false,
          romanization: 'paṛhtī',
          candidates: [
            { lemma: 'पढ़ना', pos: 'VERB', score: 1.0, features: {} },
          ],
        },
      ],
    });

    await processTextNow('text-1');

    const inserts = calls.filter(
      (c): c is Extract<Call, { kind: 'insert' }> => c.kind === 'insert',
    );
    const tokenInsert = inserts[0]!.values as Array<{
      lemmaId: string | null;
    }>;
    // Strict-POS wins → canonical row, not the legacy duplicate.
    expect(tokenInsert[0]!.lemmaId).toBe('lemma-padhna-canon');
  });

  it('marks the text failed when the NLP service throws', async () => {
    stage([{ id: 'text-1', language: 'hi' }]);
    stage([{ id: 'chap-1', body: 'oops' }]);
    stage([]); // empty lemma map
    stage([]); // empty form_lemma_overrides
    stage([]); // lemma_forms surface preload — empty for this test.
    nlpProcess.mockRejectedValueOnce(new Error('NLP service 500'));

    await expect(processTextNow('text-1')).rejects.toThrow(/NLP service 500/);

    // texts.status update happened twice: once → processing, once → failed.
    const updates = calls.filter(
      (c): c is Extract<Call, { kind: 'update' }> => c.kind === 'update',
    );
    const failed = updates.find(
      (u) => (u.set as { status?: string }).status === 'failed',
    );
    expect(failed).toBeDefined();
    expect(
      (failed!.set as { statusError: string }).statusError,
    ).toMatch(/NLP service 500/);
  });

  it('rebuilds chapter phrase spans after writing text_tokens (T-14.2)', async () => {
    stage([{ id: 'text-1', language: 'hi' }]); // text lookup
    stage([{ id: 'chap-1', body: 'one' }]); // chapters
    stage([{ id: 'lemma-bolnaa', headword: 'बोलना', pos: 'verb' }]); // lemmas
    stage([]); // form_lemma_overrides preload
    stage([]); // lemma_forms surface preload — empty for this test.

    nlpProcess.mockResolvedValueOnce({
      language: 'hi',
      pipeline_id: 'hi/stub',
      tokens: [
        {
          idx: 0,
          surface: 'बोलना',
          is_word: true,
          is_ambiguous: false,
          is_oov: false,
          romanization: 'bolnā',
          number_forms: null,
          candidates: [
            { lemma: 'बोलना', pos: 'verb', score: 0.9, features: {} },
          ],
        },
      ],
    });

    await processTextNow('text-1');
    expect(rebuildChapterSpans).toHaveBeenCalledTimes(1);
    expect(rebuildChapterSpans).toHaveBeenCalledWith({
      chapterId: 'chap-1',
      language: 'hi',
    });
  });

  it('persists NLP phrase proposals when the response includes proposed_phrases (T-14.5a)', async () => {
    stage([{ id: 'text-1', language: 'hi' }]);
    stage([{ id: 'chap-1', body: 'one' }]);
    // Pre-seed the lemma index with both candidate lemmas so
    // pickLemmaId hits byHeadwordPos and doesn't fire
    // ensureLemma's SELECT+INSERT pair per token.
    stage([
      { id: 'lemma-intazaar', headword: 'इंतज़ार', pos: 'NOUN' },
      { id: 'lemma-karnaa', headword: 'करना', pos: 'VERB' },
    ]);
    stage([]); // overrides
    stage([]); // lemma_forms surface preload — empty for this test.

    nlpProcess.mockResolvedValueOnce({
      language: 'hi',
      pipeline_id: 'hi/stub',
      tokens: [
        {
          idx: 0,
          surface: 'इंतज़ार',
          is_word: true,
          is_ambiguous: false,
          is_oov: false,
          romanization: null,
          number_forms: null,
          candidates: [
            { lemma: 'इंतज़ार', pos: 'NOUN', score: 0.9, features: {} },
          ],
        },
        {
          idx: 1,
          surface: 'किया',
          is_word: true,
          is_ambiguous: false,
          is_oov: false,
          romanization: null,
          number_forms: null,
          candidates: [
            { lemma: 'करना', pos: 'VERB', score: 0.9, features: {} },
          ],
        },
      ],
      proposed_phrases: [
        {
          start_idx: 0,
          end_idx: 1,
          pattern_id: 'hi.conjunct_verb_karna',
          surfaces: ['इंतज़ार', 'किया'],
        },
      ],
    });

    await processTextNow('text-1');
    expect(upsertPhraseProposals).toHaveBeenCalledTimes(1);
    expect(upsertPhraseProposals).toHaveBeenCalledWith({
      chapterId: 'chap-1',
      language: 'hi',
      proposals: [
        {
          start_idx: 0,
          end_idx: 1,
          pattern_id: 'hi.conjunct_verb_karna',
          surfaces: ['इंतज़ार', 'किया'],
        },
      ],
    });
  });

  it('skips the proposals upsert when the NLP response has no proposed_phrases (T-14.5a)', async () => {
    stage([{ id: 'text-1', language: 'hi' }]);
    stage([{ id: 'chap-1', body: 'one' }]);
    stage([{ id: 'lemma-bolnaa', headword: 'बोलना', pos: 'verb' }]);
    stage([]); // form_lemma_overrides preload
    stage([]); // lemma_forms surface preload — empty for this test.
    nlpProcess.mockResolvedValueOnce({
      language: 'hi',
      pipeline_id: 'hi/stub',
      tokens: [
        {
          idx: 0,
          surface: 'बोलना',
          is_word: true,
          is_ambiguous: false,
          is_oov: false,
          romanization: null,
          number_forms: null,
          candidates: [
            { lemma: 'बोलना', pos: 'verb', score: 1, features: {} },
          ],
        },
      ],
      // proposed_phrases omitted entirely (older NLP build).
    });
    await processTextNow('text-1');
    expect(upsertPhraseProposals).not.toHaveBeenCalled();
  });
});
