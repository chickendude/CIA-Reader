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
import {
  splitIntoChapters,
  estimateTokenCount,
  type ChapterDraft,
} from './chunking.js';
import { parseEpub, EpubParseError } from './epub.js';
import { enqueueNlpJob } from './jobs.js';

export { EpubParseError };

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
 * realistically read in one go. */
export const MAX_TXT_BYTES = 10_000_000;

/** Hard cap on the raw EPUB archive size (T-4.3). 50MB covers anything
 * with reasonable images; bigger files almost always indicate
 * embedded video / audio that we can't use anyway. */
export const MAX_EPUB_BYTES = 50_000_000;

/** Hard cap on the visible title; the library card and `<title>` tag
 * both render this without truncation. */
export const MAX_TITLE_LEN = 200;
export const MIN_TITLE_LEN = 1;

export type SourceType = 'paste' | 'txt' | 'epub';

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

  // Kick the NLP worker (T-4.4). The default dispatcher is a no-op so
  // tests + dev environments without arq still succeed; production
  // wiring registers a Redis-backed dispatcher at boot.
  await enqueueNlpJob({
    textId: (text as Text).id,
    chapterIds: chapterRows.map((c) => c.id),
    now: args.now,
  });

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

export type CreateEpubTextInput = {
  language: string;
  title: string;
  /** Raw EPUB archive bytes. */
  epubBytes: ArrayBuffer | Uint8Array;
};

/**
 * Create a text from an EPUB upload (T-4.3).
 *
 * EPUB chapter structure is authored — the spine is the canonical
 * order, each spine item is a chapter — so we feed the parsed
 * chapters straight into `text_chapters` without going through the
 * paragraph auto-splitter. The chunker WOULD fire only if a single
 * EPUB chapter is itself enormous (>50k tokens), which essentially
 * never happens in real publishing.
 *
 * Per-chapter NFC normalization happens here rather than in the
 * parser so the parser stays a pure XML/HTML utility usable elsewhere
 * (e.g. an admin re-import path later).
 */
export async function createEpubText(
  owner: Pick<User, 'id'>,
  input: CreateEpubTextInput,
  now: Date = new Date(),
): Promise<CreatedText> {
  if (!isSupportedLanguage(input.language)) {
    throw new TextValidationError(
      `Unsupported language '${input.language}' (expected one of: hi, mr, or)`,
    );
  }
  const language = input.language as LanguageCode;
  const title = normalizeTitle(input.title ?? '');
  if (title.length < MIN_TITLE_LEN) {
    throw new TextValidationError('title is required');
  }
  if (title.length > MAX_TITLE_LEN) {
    throw new TextValidationError(`title exceeds ${MAX_TITLE_LEN} characters`);
  }
  const byteLength =
    input.epubBytes instanceof Uint8Array
      ? input.epubBytes.byteLength
      : input.epubBytes.byteLength;
  if (byteLength > MAX_EPUB_BYTES) {
    throw new TextValidationError(
      `EPUB exceeds ${MAX_EPUB_BYTES.toLocaleString()} bytes`,
    );
  }
  if (byteLength === 0) {
    throw new TextValidationError('EPUB file is empty');
  }

  const parsed = await parseEpub(input.epubBytes);

  // For each parsed chapter, run it through the chunker — short
  // chapters stay one row, freakishly long ones get split. We then
  // re-number `idx` across the flattened result so the order is
  // contiguous regardless of any per-chapter sub-splits.
  const drafts: ChapterDraft[] = [];
  let nextIdx = 0;
  for (const c of parsed) {
    const body = c.body.normalize('NFC').replace(/\r\n?/g, '\n');
    const subChapters = splitIntoChapters(body);
    for (let i = 0; i < subChapters.length; i += 1) {
      const sub = subChapters[i]!;
      // The first sub-chapter inherits the EPUB chapter's title; any
      // additional splits within that chapter get a derived title or
      // fall back to "{title} (cont.)".
      let derivedTitle: string | null;
      if (i === 0) derivedTitle = c.title;
      else if (c.title) derivedTitle = `${c.title} (cont. ${i})`;
      else derivedTitle = sub.title;
      drafts.push({
        idx: nextIdx,
        title: derivedTitle,
        body: sub.body,
        tokenCount: sub.tokenCount,
      });
      nextIdx += 1;
    }
  }
  if (drafts.length === 0) {
    throw new TextValidationError('EPUB has no readable chapters');
  }

  return insertTextWithChapters(owner, {
    sourceType: 'epub',
    language,
    title,
    chapters: drafts,
    now,
  });
}

/**
 * Read a text + its chapters, gated by the central `canReadText`
 * helper (T-4.6). Returns `null` if the text doesn't exist OR the
 * viewer isn't allowed to read it (deny-by-default). Endpoints map
 * `null` to 404 so we don't leak existence to non-readers.
 *
 * This replaces the old owner-only `getOwnedText`. Public endpoints
 * (e.g. anonymous reads of an official text) pass `viewer = null`.
 */
export async function getReadableText(
  viewer: { id: string } | null,
  textId: string,
): Promise<{ text: Text; chapters: TextChapter[] } | null> {
  const { canReadText } = await import('../auth/can-read.js');
  const [text] = await db
    .select()
    .from(schema.texts)
    .where(eq(schema.texts.id, textId))
    .limit(1);
  if (!text) return null;
  const ok = await canReadText(viewer, text as Text);
  if (!ok) return null;
  const chapters = (await db
    .select()
    .from(schema.textChapters)
    .where(eq(schema.textChapters.textId, (text as Text).id))
    .orderBy(schema.textChapters.idx)) as TextChapter[];
  return { text: text as Text, chapters };
}

/**
 * Backwards-compatible alias for the old `getOwnedText` name. Prefer
 * `getReadableText` in new code; this exists so existing callers
 * (and their tests) don't all need to flip in one ticket.
 *
 * @deprecated Use `getReadableText` directly.
 */
export const getOwnedText = getReadableText;
