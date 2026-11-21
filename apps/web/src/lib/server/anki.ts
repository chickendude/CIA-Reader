import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync as SQLiteDatabase } from 'node:sqlite';
import JSZip from 'jszip';

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import { db, schema } from './db/index.js';
import { readerFrequencies } from './texts/reader-frequencies';
import { resolveBookChapterScope } from './texts/book-frequency.js';
import { sentenceFromTokens } from './texts/sentences.js';
import { canReadText } from './auth/can-read.js';
import type { LanguageCode } from '@ciareader/shared-types';
import { vocabularyDefinition, type VocabularyStatus } from './vocabulary.js';

export type AnkiCard = {
  /** Stable dictionary identity for catalog exports, independent of definition edits. */
  id?: string;
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

/**
 * Up to MAX_SAMPLES distinct book sentences per lemma (excluding the mined
 * one). Loads each needed chapter's tokens once and reconstructs sentences
 * around the lemma's occurrences.
 */
async function bookSamples(
  userId: string,
  bookChapterIds: string[],
  lemmas: LemmaRow[],
): Promise<Map<string, string[]>> {
  const samples = new Map<string, string[]>();
  const lemmaIds = lemmas.map((l) => l.lemmaId);
  if (lemmaIds.length === 0) return samples;

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
        sql`NOT EXISTS (SELECT 1 FROM reader_ignored_tokens i WHERE i.token_id=${schema.textTokens.id} AND i.user_id=${userId})`,
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
  opts: { textId?: string; language?: LanguageCode; status?: VocabularyStatus; includeStudied?: boolean },
): Promise<{ language: LanguageCode; cards: AnkiCard[] }> {
  let language = opts.language;
  if (opts.textId) {
    const [text] = await db
      .select()
      .from(schema.texts)
      .where(eq(schema.texts.id, opts.textId))
      .limit(1);
    if (!text || !(await canReadText({ id: userId }, text))) return { language: language ?? 'hi', cards: [] };
    language = text.language;
  }
  if (!language) {
    return { language: 'eu' as LanguageCode, cards: [] };
  }

  const { lemmas, userKnownLemmas, chapterWordFrequencies } = schema;
  const statuses: VocabularyStatus[] = opts.status ? [opts.status]
    : opts.includeStudied ? ['unknown', 'learning', 'known'] : ['unknown'];
  const selection = and(
    eq(lemmas.language, language),
    inArray(sql`coalesce(${userKnownLemmas.status}, 'unknown')`, statuses),
  );
  const fields = {
    lemmaId: lemmas.id,
    headword: lemmas.headword,
    pos: lemmas.pos,
    glossDefault: vocabularyDefinition(userId),
    minedSentence: userKnownLemmas.minedSentence,
  };
  const savedByUser = and(eq(userKnownLemmas.lemmaId, lemmas.id), eq(userKnownLemmas.userId, userId));

  const chapterIds = opts.textId ? (await resolveBookChapterScope(opts.textId, userId)).bookChapterIds : [];
  if (opts.textId && !chapterIds.length) return { language, cards: [] };
  const frequency = sql<number>`sum(${chapterWordFrequencies.occurrences})::int`;
  const rows = opts.textId
    ? await db.select({ ...fields, frequency })
        .from(sql`${readerFrequencies('chapter', userId)} AS chapter_word_frequencies`)
        .innerJoin(lemmas, eq(lemmas.id, chapterWordFrequencies.lemmaId))
        .leftJoin(userKnownLemmas, savedByUser)
        .where(and(selection, inArray(chapterWordFrequencies.chapterId, chapterIds)))
        .groupBy(lemmas.id, userKnownLemmas.minedSentence)
        .orderBy(desc(frequency), asc(lemmas.headword), asc(lemmas.id))
    : await db.select({ ...fields, frequency: sql<number>`0` })
        .from(lemmas)
        .innerJoin(userKnownLemmas, savedByUser)
        .where(selection)
        .orderBy(asc(lemmas.headword), asc(lemmas.id));
  const samples = opts.textId ? await bookSamples(userId, chapterIds, rows) : new Map<string, string[]>();

  const cards = rows.map((row) => ({
    id: row.lemmaId,
    word: row.headword,
    pos: row.pos,
    definition: row.glossDefault ?? '',
    frequency: row.frequency,
    minedSentence: row.minedSentence,
    samples: samples.get(row.lemmaId) ?? [],
  }));
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
  if (card.frequency > 0) parts.push(`<div class="frequency">${card.frequency} occurrences</div>`);
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
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  // Reuse the Anki schema/template, but use native SQLite: the package's
  // bundled sql.js has a fixed 16 MB heap and fails on full-book decks.
  const template = require('anki-apkg-export/dist/template').default as () => string;
  const directory = await mkdtemp(join(tmpdir(), 'parhiba-anki-'));
  let sqlite: SQLiteDatabase | undefined;
  try {
    const path = join(directory, 'collection.anki2');
    sqlite = new DatabaseSync(path);
    sqlite.exec(template());
    const now = Date.now(), seconds = Math.floor(now / 1000);
    const stableId = (value: string) => Number.parseInt(createHash('sha256').update(value).digest('hex').slice(0, 12), 16);
    const deckId = stableId(`parhiba:deck:${deckName}`), modelId = stableId('parhiba:vocabulary:v1');
    const row = sqlite.prepare('SELECT conf,models,decks FROM col').get()!;
    const model = Object.values(JSON.parse(String(row.models)))[0] as Record<string, unknown>;
    const decks = JSON.parse(String(row.decks));
    const deck = Object.values(decks).find((d) => (d as { name: string }).name === 'Template') as Record<string, unknown>;
    const conf = JSON.parse(String(row.conf));
    const models = { [modelId]: { ...model, id: modelId, name: 'Parhiba Vocabulary', did: deckId, mod: seconds } };
    const updatedDecks = { 1: decks[1], [deckId]: { ...deck, id: deckId, name: deckName, mod: seconds,
      newToday: [0,0], revToday: [0,0], lrnToday: [0,0], timeToday: [0,0] } };
    sqlite.prepare('UPDATE col SET mod=?,models=?,decks=?,conf=?').run(now, JSON.stringify(models), JSON.stringify(updatedDecks),
      JSON.stringify({ ...conf, nextPos: cards.length + 1, curDeck: deckId, activeDecks: [deckId], curModel: String(modelId) }));
    const note = sqlite.prepare('INSERT INTO notes VALUES(?,?,?,?,?,?,?,?,?,?,?)');
    const item = sqlite.prepare('INSERT INTO cards VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    sqlite.exec('BEGIN');
    for (const [index, card] of cards.entries()) {
      const id = now + index;
      const guid = card.id ? `parhiba-${card.id}` : createHash('sha256').update(`${deckName}\0${card.word}\0${card.pos}`).digest('hex');
      const front = escapeHtml(card.word);
      const checksum = Number.parseInt(createHash('sha1').update(card.word).digest('hex').slice(0,8),16);
      note.run(id,guid,modelId,seconds,-1,'',`${front}\x1f${cardBackHtml(card)}`,card.word,checksum,0,'');
      item.run(id,id,deckId,0,seconds,-1,0,0,index+1,0,0,0,0,0,0,0,0,'');
    }
    sqlite.exec('COMMIT');
    sqlite.close();
    sqlite = undefined;
    const archive = new JSZip();
    archive.file('collection.anki2', await readFile(path));
    archive.file('media', '{}');
    return await archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  } finally {
    sqlite?.close();
    await rm(directory, { recursive: true, force: true });
  }
}
