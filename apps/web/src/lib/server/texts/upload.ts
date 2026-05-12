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
import { isSupportedLanguage, LANGUAGES } from '@ciareader/shared-types';
import type { Collection, Text, TextChapter, User } from '../db/schema.js';
import {
  splitIntoChapters,
  estimateTokenCount,
  type ChapterDraft,
} from './chunking.js';
import { parseEpub, EpubParseError } from './epub.js';
import { parseChapterZip, ZipParseError } from './zip.js';
import { enqueueNlpJob } from './jobs.js';
import { createChapterBookCollection } from '../collections.js';

export { EpubParseError, ZipParseError };

export class TextValidationError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404 = 400,
  ) {
    super(message);
    this.name = 'TextValidationError';
  }
}

/**
 * Thrown when an EPUB's `<dc:language>` is one of our supported codes
 * but doesn't match the language the user selected at upload time.
 * The form/API layer surfaces the message so the user can fix the
 * dropdown without re-picking the file.
 */
export class EpubLanguageMismatchError extends TextValidationError {
  constructor(
    public readonly declaredLanguage: LanguageCode,
    public readonly selectedLanguage: string,
  ) {
    const declaredName = LANGUAGES[declaredLanguage].displayName;
    const selectedName = LANGUAGES[selectedLanguage as LanguageCode]?.displayName
      ?? selectedLanguage;
    super(
      `This EPUB declares its language as ${declaredName} (${declaredLanguage}),` +
        ` but you selected ${selectedName}. Re-select the language or upload a different file.`,
    );
    this.name = 'EpubLanguageMismatchError';
  }
}

/**
 * Thrown when an EPUB's `<dc:language>` is set to something outside
 * the supported set (Hindi / Marathi / Odia). MVP only handles three
 * languages — an English / French / etc. EPUB would tokenize as
 * garbage if we just trusted the user's dropdown.
 */
export class EpubLanguageUnsupportedError extends TextValidationError {
  constructor(public readonly declaredLanguage: string) {
    super(
      `This EPUB is declared as language '${declaredLanguage}', which isn't supported yet ` +
        `(only Hindi / Marathi / Odia are available).`,
    );
    this.name = 'EpubLanguageUnsupportedError';
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

/** Hard cap on a chapter-book ZIP upload. Same envelope as EPUB —
 * a few MB of `.txt` files compress trivially, but we don't want the
 * surface area for someone to bury a multi-gig archive in the form. */
export const MAX_ZIP_BYTES = 50_000_000;

/** Hard cap on the visible title; the library card and `<title>` tag
 * both render this without truncation. */
export const MAX_TITLE_LEN = 200;
export const MIN_TITLE_LEN = 1;

export type SourceType = 'paste' | 'txt' | 'epub' | 'zip';

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

export type CreateChapterBookFromEpubInput = {
  language: string;
  title: string;
  /** Raw EPUB archive bytes. */
  epubBytes: ArrayBuffer | Uint8Array;
};

export type CreateChapterBookFromZipInput = {
  language: string;
  title: string;
  /** Raw ZIP archive bytes. */
  zipBytes: ArrayBuffer | Uint8Array;
};

/**
 * Result of the EPUB/ZIP chapter-book creators. Two shapes because
 * the single-chapter case falls back to a plain `texts` row (a 1-item
 * collection is awkward UX — the reader page goes straight there).
 *
 * Callers branch on `kind` to redirect the user to either
 * `/reader/<id>` (plain text) or `/collections/<id>` (chapter book).
 */
export type ChapterBookResult =
  | { kind: 'text'; text: Text; chapter: TextChapter; chapters: TextChapter[] }
  | {
      kind: 'collection';
      collection: Collection;
      texts: Text[];
    };

/**
 * A `ChapterDraft` extended with the parent-section heading from
 * the source nav doc. Carried through `buildChapterDrafts` into
 * `createChapterBookCollection`, which writes it to the
 * `collection_items.section_title` column for grouped rendering on
 * the collection detail page.
 */
export type ChapterDraftWithSection = ChapterDraft & {
  section: string | null;
};

/**
 * Run each parsed chapter through the auto-splitter and produce
 * contiguous `ChapterDraft`s. A short chapter passes through as one
 * draft; an enormous chapter (>50k tokens — basically never in
 * real publishing) gets split at paragraph boundaries with the title
 * suffixed `"(cont. N)"` so the order remains obvious in the reader.
 *
 * Shared by the EPUB and ZIP paths; the only thing that differs
 * between them is where the per-chapter title/body pairs come from.
 * The optional `section` per input chapter — only set by the EPUB
 * path when the nav doc nests this chapter under a parent heading —
 * propagates onto every sub-chunk so a "(cont. 1)" split inherits
 * its parent's part membership.
 */
function buildChapterDrafts(
  chapters: Array<{ title: string | null; body: string; section?: string | null }>,
): ChapterDraftWithSection[] {
  const drafts: ChapterDraftWithSection[] = [];
  let nextIdx = 0;
  for (const c of chapters) {
    const body = c.body.normalize('NFC').replace(/\r\n?/g, '\n');
    const subChapters = splitIntoChapters(body);
    const section = c.section ?? null;
    for (let i = 0; i < subChapters.length; i += 1) {
      const sub = subChapters[i]!;
      // First sub-chapter inherits the source's title; further sub-
      // splits get a derived "(cont. N)" suffix or fall back to the
      // chunker's title.
      let derivedTitle: string | null;
      if (i === 0) derivedTitle = c.title;
      else if (c.title) derivedTitle = `${c.title} (cont. ${i})`;
      else derivedTitle = sub.title;
      drafts.push({
        idx: nextIdx,
        title: derivedTitle,
        body: sub.body,
        tokenCount: sub.tokenCount,
        section,
      });
      nextIdx += 1;
    }
  }
  return drafts;
}

/**
 * Convert a single-chapter `ChapterDraft` into a plain pasted text.
 * Used by the EPUB/ZIP fallback when only one chapter came out of
 * the file — there's no point spinning up a 1-item collection just
 * to wrap a single text.
 */
async function createSingleChapterFallback(
  owner: Pick<User, 'id'>,
  args: {
    sourceType: 'epub' | 'zip';
    language: LanguageCode;
    title: string;
    draft: ChapterDraft;
    now: Date;
  },
): Promise<CreatedText> {
  return insertTextWithChapters(owner, {
    sourceType: args.sourceType,
    language: args.language,
    title: args.title,
    chapters: [args.draft],
    now: args.now,
  });
}

/**
 * Create a chapter-book collection from an EPUB.
 *
 * Each spine chapter becomes its own `texts` row (so each gets its
 * own status, NLP job, progress %, audio binding) inside a
 * `collections` row of kind `chapter_book`. If the EPUB declares
 * `<dc:language>` and it disagrees with the user's selection, the
 * upload is rejected so we don't tokenize a Marathi book under the
 * Hindi pipeline.
 *
 * When only one readable chapter exists after parsing + chunking,
 * the result is a single `texts` row (kind `text`) — callers
 * redirect to `/reader/<id>` rather than a 1-item collection page.
 */
export async function createChapterBookFromEpub(
  owner: Pick<User, 'id'>,
  input: CreateChapterBookFromEpubInput,
  now: Date = new Date(),
): Promise<ChapterBookResult> {
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
  const byteLength = input.epubBytes.byteLength;
  if (byteLength > MAX_EPUB_BYTES) {
    throw new TextValidationError(
      `EPUB exceeds ${MAX_EPUB_BYTES.toLocaleString()} bytes`,
    );
  }
  if (byteLength === 0) {
    throw new TextValidationError('EPUB file is empty');
  }

  const parsed = await parseEpub(input.epubBytes);

  // Language verification (T-EPUB language gate). Only fires when the
  // EPUB actually declares its language — most authoring tools do, but
  // we don't penalize files that don't.
  if (parsed.language !== null && parsed.language !== language) {
    if (isSupportedLanguage(parsed.language)) {
      throw new EpubLanguageMismatchError(
        parsed.language as LanguageCode,
        input.language,
      );
    }
    throw new EpubLanguageUnsupportedError(parsed.language);
  }

  const drafts = buildChapterDrafts(parsed.chapters);
  if (drafts.length === 0) {
    throw new TextValidationError('EPUB has no readable chapters');
  }

  if (drafts.length === 1) {
    const single = await createSingleChapterFallback(owner, {
      sourceType: 'epub',
      language,
      title,
      draft: drafts[0]!,
      now,
    });
    return {
      kind: 'text',
      text: single.text,
      chapter: single.chapter,
      chapters: single.chapters,
    };
  }

  const created = await createChapterBookCollection({
    ownerId: owner.id,
    language,
    title,
    sourceType: 'epub',
    chapters: drafts,
    now,
  });
  return {
    kind: 'collection',
    collection: created.collection,
    texts: created.texts,
  };
}

/**
 * Create a chapter-book collection from a ZIP of `.txt` files.
 *
 * Layout convention is "flat top-level `.txt` files, lexicographic
 * order" — see `parseChapterZip` for the spec. Filename minus the
 * `.txt` extension is the chapter title. Unlike EPUB there's no
 * declared language tag; we trust the user's dropdown selection.
 *
 * Single-chapter fallback matches the EPUB path: one `.txt` file
 * lands as a plain `texts` row, not a 1-item collection.
 */
export async function createChapterBookFromZip(
  owner: Pick<User, 'id'>,
  input: CreateChapterBookFromZipInput,
  now: Date = new Date(),
): Promise<ChapterBookResult> {
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
  const byteLength = input.zipBytes.byteLength;
  if (byteLength > MAX_ZIP_BYTES) {
    throw new TextValidationError(
      `ZIP exceeds ${MAX_ZIP_BYTES.toLocaleString()} bytes`,
    );
  }
  if (byteLength === 0) {
    throw new TextValidationError('ZIP file is empty');
  }

  const parsed = await parseChapterZip(input.zipBytes);
  const drafts = buildChapterDrafts(parsed);
  if (drafts.length === 0) {
    throw new TextValidationError('ZIP has no readable chapters');
  }

  if (drafts.length === 1) {
    const single = await createSingleChapterFallback(owner, {
      sourceType: 'zip',
      language,
      title,
      draft: drafts[0]!,
      now,
    });
    return {
      kind: 'text',
      text: single.text,
      chapter: single.chapter,
      chapters: single.chapters,
    };
  }

  const created = await createChapterBookCollection({
    ownerId: owner.id,
    language,
    title,
    sourceType: 'zip',
    chapters: drafts,
    now,
  });
  return {
    kind: 'collection',
    collection: created.collection,
    texts: created.texts,
  };
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

/**
 * Delete a text. Owner-or-admin only; matches the policy on the
 * collection delete endpoint. Cascades through `text_chapters`,
 * `text_tokens`, `nlp_jobs`, `text_shares`, `text_group_shares`,
 * `user_text_progress`, `collection_items`, and `audio_files` —
 * every dependent table declares `onDelete: 'cascade'` on its
 * `text_id` FK, so a single DELETE on `texts` clears the lot.
 *
 * Throws `TextValidationError(404)` for a missing text, or for a
 * non-owner non-admin actor — same status code in both cases so we
 * don't leak existence to a viewer who isn't allowed to delete.
 */
export async function deleteText(
  textId: string,
  actor: Pick<User, 'id' | 'role'>,
): Promise<void> {
  const [row] = (await db
    .select({ id: schema.texts.id, ownerId: schema.texts.ownerId })
    .from(schema.texts)
    .where(eq(schema.texts.id, textId))
    .limit(1)) as Array<{ id: string; ownerId: string | null }>;
  if (!row) throw new TextValidationError('Text not found', 404);
  const isOwner = row.ownerId !== null && row.ownerId === actor.id;
  if (!isOwner && actor.role !== 'admin') {
    throw new TextValidationError('Text not found', 404);
  }
  await db.delete(schema.texts).where(eq(schema.texts.id, textId));
}
