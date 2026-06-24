/**
 * Anki export for the words a user is learning.
 *
 * Builds one card per `learning` lemma: front = the word, back = its
 * definition + the sentence the user mined it from + 1–2 more sample
 * sentences from the book. When a `textId` is given the cards are scoped to
 * that book and carry the book-wide occurrence count (so the page can sort
 * frequent words first); otherwise it's a language-wide export.
 *
 * Two delivery paths share this builder: a downloadable `.apkg`
 * (`buildApkg`) and AnkiConnect (the page posts `getAnkiCards` JSON to the
 * user's local Anki). `.apkg` generation uses `anki-apkg-export` (CommonJS +
 * sql.js), loaded via `createRequire` to sidestep ESM interop.
 */
import { createRequire } from 'node:module';

import { and, asc, eq, inArray } from 'drizzle-orm';

import { db, schema } from './db/index.js';
import { lemmaBookFrequencies, resolveBookChapterScope } from './texts/book-frequency.js';
import { sentenceFromTokens } from './texts/sentences.js';
import type { LanguageCode } from '@ciareader/shared-types';
import type { VocabularyStatus } from './vocabulary.js';

export type AnkiCard = {
  word: string;
  pos: string;
  definition: string;
  /** Book-wide occurrence count (0 for a language-wide export). */
  frequency: number;
  /** The sentence the word was mined from, if captured. */
  minedSentence: string | null;
  /** Up to 2 other sentences from the book containing the word. */
  samples: string[];
};

const MAX_SAMPLES = 2;
const MAX_OCC_PER_LEMMA = 8;

type LemmaRow = {
  lemmaId: string;
  headword: string;
  pos: string;
  glossDefault: string | null;
  minedSentence: string | null;
};

async function personalGlossMap(
  userId: string,
  lemmaIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (lemmaIds.length === 0) return out;
  const rows = await db
    .select({ lemmaId: schema.translations.targetId, body: schema.translations.body })
    .from(schema.translations)
    .where(
      and(
        eq(schema.translations.targetType, 'lemma'),
        eq(schema.translations.source, 'user'),
        eq(schema.translations.submittedBy, userId),
        inArray(schema.translations.targetId, lemmaIds),
      ),
    );
  for (const r of rows) {
    if (r.lemmaId && !out.has(r.lemmaId)) out.set(r.lemmaId, r.body);
  }
  return out;
}

/**
 * Up to MAX_SAMPLES distinct book sentences per lemma (excluding the mined
 * one). Loads each needed chapter's tokens once and reconstructs sentences
 * around the lemma's occurrences.
 */
async function bookSamples(
  textId: string,
  lemmas: LemmaRow[],
): Promise<Map<string, string[]>> {
  const samples = new Map<string, string[]>();
  const lemmaIds = lemmas.map((l) => l.lemmaId);
  if (lemmaIds.length === 0) return samples;

  const { bookChapterIds } = await resolveBookChapterScope(textId);
  if (bookChapterIds.length === 0) return samples;

  const occ = await db
    .select({
      lemmaId: schema.textTokens.lemmaId,
      chapterId: schema.textTokens.chapterId,
      idx: schema.textTokens.idx,
    })
    .from(schema.textTokens)
    .where(
      and(
        inArray(schema.textTokens.lemmaId, lemmaIds),
        inArray(schema.textTokens.chapterId, bookChapterIds),
      ),
    )
    .orderBy(asc(schema.textTokens.chapterId), asc(schema.textTokens.idx));

  // Keep a bounded number of occurrences per lemma.
  const perLemma = new Map<string, Array<{ chapterId: string; idx: number }>>();
  const neededChapters = new Set<string>();
  for (const o of occ) {
    if (!o.lemmaId) continue;
    const list = perLemma.get(o.lemmaId) ?? [];
    if (list.length >= MAX_OCC_PER_LEMMA) continue;
    list.push({ chapterId: o.chapterId, idx: o.idx });
    perLemma.set(o.lemmaId, list);
    neededChapters.add(o.chapterId);
  }

  // Load each needed chapter's tokens once. `isWord` lets sentenceFromTokens
  // stop at paragraph/heading breaks rather than mining across them.
  const chapterTokens = new Map<
    string,
    Array<{ idx: number; surface: string; isWord: boolean }>
  >();
  for (const chapterId of neededChapters) {
    const rows = await db
      .select({
        idx: schema.textTokens.idx,
        surface: schema.textTokens.surface,
        isWord: schema.textTokens.isWord,
      })
      .from(schema.textTokens)
      .where(eq(schema.textTokens.chapterId, chapterId))
      .orderBy(asc(schema.textTokens.idx));
    chapterTokens.set(chapterId, rows);
  }

  for (const lemma of lemmas) {
    const occs = perLemma.get(lemma.lemmaId) ?? [];
    const seen = new Set<string>();
    if (lemma.minedSentence) seen.add(lemma.minedSentence);
    const picked: string[] = [];
    for (const o of occs) {
      const tokens = chapterTokens.get(o.chapterId);
      if (!tokens) continue;
      const sentence = sentenceFromTokens(tokens, o.idx);
      if (sentence && !seen.has(sentence)) {
        seen.add(sentence);
        picked.push(sentence);
        if (picked.length >= MAX_SAMPLES) break;
      }
    }
    if (picked.length > 0) samples.set(lemma.lemmaId, picked);
  }
  return samples;
}

export async function getAnkiCards(
  userId: string,
  opts: { textId?: string; language?: LanguageCode; status?: VocabularyStatus },
): Promise<{ language: LanguageCode; cards: AnkiCard[] }> {
  let language = opts.language;
  if (!language && opts.textId) {
    const [text] = await db
      .select({ language: schema.texts.language })
      .from(schema.texts)
      .where(eq(schema.texts.id, opts.textId))
      .limit(1);
    language = text?.language as LanguageCode | undefined;
  }
  if (!language) {
    return { language: 'eu' as LanguageCode, cards: [] };
  }

  const status = opts.status ?? 'learning';
  const rows: LemmaRow[] = await db
    .select({
      lemmaId: schema.userKnownLemmas.lemmaId,
      headword: schema.lemmas.headword,
      pos: schema.lemmas.pos,
      glossDefault: schema.lemmas.glossDefault,
      minedSentence: schema.userKnownLemmas.minedSentence,
    })
    .from(schema.userKnownLemmas)
    .innerJoin(schema.lemmas, eq(schema.lemmas.id, schema.userKnownLemmas.lemmaId))
    .where(
      and(
        eq(schema.userKnownLemmas.userId, userId),
        eq(schema.userKnownLemmas.status, status),
        eq(schema.lemmas.language, language),
      ),
    )
    .orderBy(asc(schema.lemmas.headword));

  const lemmaIds = rows.map((r) => r.lemmaId);
  const personal = await personalGlossMap(userId, lemmaIds);
  const frequencies = opts.textId
    ? await lemmaBookFrequencies(opts.textId, lemmaIds)
    : new Map<string, number>();
  const samples = opts.textId ? await bookSamples(opts.textId, rows) : new Map();

  const cards: AnkiCard[] = rows.map((r) => ({
    word: r.headword,
    pos: r.pos,
    definition: personal.get(r.lemmaId) ?? r.glossDefault ?? '',
    frequency: frequencies.get(r.lemmaId) ?? 0,
    minedSentence: r.minedSentence ?? null,
    samples: samples.get(r.lemmaId) ?? [],
  }));

  // Most-frequent first when we have counts; otherwise alphabetical (already
  // sorted by headword above).
  if (opts.textId) cards.sort((a, b) => b.frequency - a.frequency);
  return { language, cards };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Render a card's back as Anki HTML: definition, then the mined sentence and
 *  any samples. */
export function cardBackHtml(card: AnkiCard): string {
  const parts: string[] = [];
  if (card.definition) parts.push(`<div class="def">${escapeHtml(card.definition)}</div>`);
  if (card.pos) parts.push(`<div class="pos">${escapeHtml(card.pos)}</div>`);
  const sentences = [
    ...(card.minedSentence ? [card.minedSentence] : []),
    ...card.samples,
  ];
  for (const s of sentences) {
    parts.push(`<div class="sentence">${escapeHtml(s)}</div>`);
  }
  return parts.join('');
}

/** Build a `.apkg` deck (a zip Buffer) from the given cards. */
export async function buildApkg(deckName: string, cards: AnkiCard[]): Promise<Buffer> {
  const require = createRequire(import.meta.url);
  const mod = require('anki-apkg-export');
  const AnkiExport = (mod.default ?? mod) as new (name: string) => {
    addCard(front: string, back: string): void;
    save(): Promise<Buffer | Uint8Array>;
  };
  const apkg = new AnkiExport(deckName);
  for (const card of cards) {
    apkg.addCard(escapeHtml(card.word), cardBackHtml(card));
  }
  const zip = await apkg.save();
  return Buffer.isBuffer(zip) ? zip : Buffer.from(zip);
}
