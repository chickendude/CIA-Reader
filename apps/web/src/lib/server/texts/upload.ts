/**
 * Text upload service (T-4.1, extended T-4.2).
 *
 * Front door for everything that lands in `texts` + `text_chapters`.
 * The reader/loader and library views read from those tables; the NLP
 * worker (T-4.4) processes them async. Keeping the create paths here
 * means downstream code has a single seam to add behaviors like "kick
 * the queue after insert" without touching every callsite.
 *
 * Two creators today:
 *
 *  - `createPastedText` — the paste box. Tight 1MB byte cap because we
 *    don't want a 10MB paste blocking a request thread; the file
 *    drop-zone is the right tool for that.
 *  - `createTxtText` — `.txt` file ingest (T-4.2). Bigger 10MB cap
 *    because dropping a whole novel as a `.txt` file is the intended
 *    use. Both feed `splitIntoChapters` (T-4.2's chunker), so a long
 *    body — paste OR file — auto-splits into reader-sized chapters.
 *
 * EPUB ingest lands in T-4.3 with its own creator that consumes the
 * archive's per-chapter HTML directly; chapter boundaries from the
 * source aren't subject to the auto-splitter at all.
 *
 * Authorization: every text gets `owner_id = creator.id` and
 * `visibility = 'private'` by default. Sharing + official promotion go
 * through M7 endpoints, never this one.
 */
import { eq } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import type { LanguageCode } from '@ciareader/shared-types';
import { isSupportedLanguage } from '@ciareader/shared-types';
import type { Text, TextChapter, User } from '../db/schema.js';
import { splitIntoChapters, estimateTokenCount } from './chunking.js';

export class TextValidationError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404 = 400,
  ) {
    super(message);
    this.name = 'TextValidationError';
  }
}

/** Hard cap on a single pasted body. 1 MB of UTF-8 is comfortably
 * bigger than a typical short story but small enough that we don't
 * accidentally accept a whole novel pasted into the textarea (use the
 * `.txt` drop-zone for that). */
export const MAX_PASTE_BYTES = 1_000_000;

/** Hard cap on a `.txt` upload (T-4.2). 10MB is enough for any
 * realistic novel + a generous margin — at ~3 bytes/codepoint for
 * Devanagari that's ~3M codepoints, well past anything a user would
 * realistically read in one go. EPUB uploads stream chapter-by-chapter
 * and don't pay a single-blob cap (T-4.3). */
export const MAX_TXT_BYTES = 10_000_000;

/** Hard cap on the visible title; the library card and `<title>` tag
 * both render this without truncation. */
export const MAX_TITLE_LEN = 200;
export const MIN_TITLE_LEN = 1;

export type SourceType = 'paste' | 'txt';

export type CreatePastedTextInput = {
  language: string;
  title: string;
  body: string;
};

export type CreateTxtTextInput = CreatePastedTextInput;

export type CreatedText = {
  text: Text;
  /** First chapter (idx=0) — convenient for the typical "redirect to
   * the reader" caller. The full chapter list is on `chapters`. */
  chapter: TextChapter;
  chapters: TextChapter[];
};

// Re-export so callers don't have to know about the chunking module.
export { estimateTokenCount };

function normalizeBody(body: string): string {
  // NFC is the canonical form for Indic scripts in our DB; doing it once
  // at write time means every downstream reader (tokenizer, search,
  // diff) compares apples to apples. Internal CR / CRLF are flattened
  // to LF so the chunker's paragraph regex doesn't need to special-
  // case line-ending styles.
  return body.normalize('NFC').replace(/\r\n?/g, '\n');
}

function normalizeTitle(title: string): string {
  // Collapse internal whitespace so "Chapter   1" doesn't silently
  // become a different title from "Chapter 1" depending on copy-paste.
  return title.normalize('NFC').trim().replace(/\s+/g, ' ');
}

function validateInput(
  input: CreatePastedTextInput,
  byteCap: number,
): { language: LanguageCode; title: string; body: string } {
  if (!isSupportedLanguage(input.language)) {
    throw new TextValidationError(
      `Unsupported language '${input.language}' (expected one of: hi, mr, or)`,
    );
  }
  const title = normalizeTitle(input.title ?? '');
  if (title.length < MIN_TITLE_LEN) {
    throw new TextValidationError('title is required');
  }
  if (title.length > MAX_TITLE_LEN) {
    throw new TextValidationError(`title exceeds ${MAX_TITLE_LEN} characters`);
  }
  const body = normalizeBody(input.body ?? '');
  if (body.trim().length === 0) {
    throw new TextValidationError('body cannot be empty');
  }
  // UTF-8 byte length, not char length — the cap is about bytes
  // flowing over the wire and into a Postgres TEXT column, not
  // codepoints.
  const bodyBytes = new TextEncoder().encode(body).byteLength;
  if (bodyBytes > byteCap) {
    throw new TextValidationError(
      `body exceeds ${byteCap.toLocaleString()} bytes`,
    );
  }
  return { language: input.language as LanguageCode, title, body };
}

/**
 * Internal helper shared by every creator. Inserts the `texts` row +
 * one `text_chapters` row per draft and returns them all. Splitting
 * the body into chapter drafts is the caller's responsibility — paste
 * and `.txt` go through the same `splitIntoChapters`; EPUB (T-4.3)
 * will pass already-structured chapters straight in.
 */
async function insertTextWithChapters(
  owner: Pick<User, 'id'>,
  args: {
    sourceType: SourceType;
    language: LanguageCode;
    title: string;
    chapters: Array<{
      idx: number;
      title: string | null;
      body: string;
      tokenCount: number;
    }>;
    now: Date;
  },
): Promise<CreatedText> {
  const [text] = await db
    .insert(schema.texts)
    .values({
      ownerId: owner.id,
      language: args.language,
      title: args.title,
      sourceType: args.sourceType,
      status: 'pending',
      visibility: 'private',
      createdAt: args.now,
      updatedAt: args.now,
    })
    .returning();
  if (!text) throw new Error('Failed to insert text row');

  const chapterRows = (await db
    .insert(schema.textChapters)
    .values(
      args.chapters.map((c) => ({
        textId: (text as Text).id,
        idx: c.idx,
        title: c.title,
        body: c.body,
        tokenCount: c.tokenCount,
        createdAt: args.now,
      })),
    )
    .returning()) as TextChapter[];
  if (chapterRows.length === 0) throw new Error('Failed to insert chapter rows');

  // Sort defensively — drizzle's `returning` doesn't guarantee insert
  // order across drivers.
  chapterRows.sort((a, b) => a.idx - b.idx);

  return {
    text: text as Text,
    chapter: chapterRows[0]!,
    chapters: chapterRows,
  };
}

/**
 * Create a pasted text. The body is run through the chapter chunker
 * just like a `.txt` upload would be — short bodies stay one chapter,
 * longer ones (or ones with explicit `\f` / `---` delimiters) split
 * automatically.
 */
export async function createPastedText(
  owner: Pick<User, 'id'>,
  input: CreatePastedTextInput,
  now: Date = new Date(),
): Promise<CreatedText> {
  const { language, title, body } = validateInput(input, MAX_PASTE_BYTES);
  const drafts = splitIntoChapters(body);
  return insertTextWithChapters(owner, {
    sourceType: 'paste',
    language,
    title,
    chapters: drafts,
    now,
  });
}

/**
 * Create a text from a `.txt` upload (T-4.2). The body is treated as
 * plain UTF-8 and run through the chunker — explicit `\f` / `---`
 * delimiters from the original file are honored, otherwise the
 * paragraph-boundary auto-splitter fires above the threshold.
 */
export async function createTxtText(
  owner: Pick<User, 'id'>,
  input: CreateTxtTextInput,
  now: Date = new Date(),
): Promise<CreatedText> {
  const { language, title, body } = validateInput(input, MAX_TXT_BYTES);
  const drafts = splitIntoChapters(body);
  return insertTextWithChapters(owner, {
    sourceType: 'txt',
    language,
    title,
    chapters: drafts,
    now,
  });
}

/**
 * Read one of the user's own texts plus its chapters, in order. Used by
 * the placeholder reader page T-4.1 shipped (a temporary view of the
 * raw body — the real reader lands in M5). Returns `null` if the text
 * doesn't exist OR is not readable by `viewer`.
 *
 * Sharing / official-text reads go through `assertCanRead` in T-4.6;
 * for now the rule is simply "owner can read their own private texts."
 */
export async function getOwnedText(
  viewer: Pick<User, 'id'>,
  textId: string,
): Promise<{ text: Text; chapters: TextChapter[] } | null> {
  const [text] = await db
    .select()
    .from(schema.texts)
    .where(eq(schema.texts.id, textId))
    .limit(1);
  if (!text) return null;
  if ((text as Text).ownerId !== viewer.id) return null;
  const chapters = (await db
    .select()
    .from(schema.textChapters)
    .where(eq(schema.textChapters.textId, (text as Text).id))
    .orderBy(schema.textChapters.idx)) as TextChapter[];
  return { text: text as Text, chapters };
}
