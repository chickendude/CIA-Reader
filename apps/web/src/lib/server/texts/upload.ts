/**
 * Text upload service (T-4.1).
 *
 * Front door for everything that lands in `texts` + `text_chapters`.
 * The reader/loader and library views read from those tables; the NLP
 * worker (T-4.4) processes them async. Keeping the create paths here
 * means downstream code has a single seam to add behaviors like "kick
 * the queue after insert" without touching every callsite.
 *
 * MVP scope (T-4.1):
 *  - `createPastedText` is the only public creator. It writes one
 *    `texts` row + a single `text_chapters` row holding the NFC-
 *    normalized body. Status starts `pending`; T-4.4 will flip it to
 *    `ready` after NLP runs.
 *  - `.txt` and `.epub` ingest land in T-4.2 / T-4.3 and will reuse
 *    this module — `createPastedText` becomes one of several creators,
 *    all sharing validation + visibility defaults.
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

export class TextValidationError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404 = 400,
  ) {
    super(message);
    this.name = 'TextValidationError';
  }
}

/** Hard cap on a single pasted body. 1 MB of UTF-8 is comfortably bigger
 * than a typical short story but small enough that we don't accidentally
 * accept a whole novel pasted into the textarea (use EPUB upload for
 * that — T-4.3). */
export const MAX_PASTE_BYTES = 1_000_000;

/** Hard cap on the visible title; the library card and `<title>` tag
 * both render this without truncation. */
export const MAX_TITLE_LEN = 200;
export const MIN_TITLE_LEN = 1;

export type CreatePastedTextInput = {
  language: string;
  title: string;
  body: string;
};

export type CreatePastedTextResult = {
  text: Text;
  chapter: TextChapter;
};

function normalizeBody(body: string): string {
  // NFC is the canonical form for Indic scripts in our DB; doing it once
  // at write time means every downstream reader (tokenizer, search,
  // diff) compares apples to apples. Internal CR / CRLF are flattened
  // to LF so paragraph splitting in T-4.2 doesn't need to special-case
  // line-ending styles.
  return body.normalize('NFC').replace(/\r\n?/g, '\n');
}

function normalizeTitle(title: string): string {
  // Collapse internal whitespace so "Chapter   1" doesn't silently
  // become a different title from "Chapter 1" depending on copy-paste.
  return title.normalize('NFC').trim().replace(/\s+/g, ' ');
}

/**
 * Cheap whitespace-based token estimator. The real token count comes
 * from the NLP worker (T-4.4) and overwrites this. We seed it to
 * something useful so the library card has a number to render even
 * before the worker has run.
 */
export function estimateTokenCount(body: string): number {
  const trimmed = body.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

function validateInput(input: CreatePastedTextInput): {
  language: LanguageCode;
  title: string;
  body: string;
} {
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
  // UTF-8 byte length, not char length — the cap is about bytes flowing
  // over the wire and into a Postgres TEXT column, not codepoints.
  const bodyBytes = new TextEncoder().encode(body).byteLength;
  if (bodyBytes > MAX_PASTE_BYTES) {
    throw new TextValidationError(
      `body exceeds ${MAX_PASTE_BYTES.toLocaleString()} bytes; use EPUB upload for longer texts`,
    );
  }
  return { language: input.language as LanguageCode, title, body };
}

/**
 * Create a pasted text + a single chapter for the given owner.
 *
 * The chapter holds the entire body. When T-4.2 lands, long pastes will
 * auto-split into multiple chapter rows at paragraph boundaries; this
 * function's contract (returns the freshly created text + the *first*
 * chapter) is stable regardless.
 */
export async function createPastedText(
  owner: Pick<User, 'id'>,
  input: CreatePastedTextInput,
  now: Date = new Date(),
): Promise<CreatePastedTextResult> {
  const { language, title, body } = validateInput(input);

  const [text] = await db
    .insert(schema.texts)
    .values({
      ownerId: owner.id,
      language,
      title,
      sourceType: 'paste',
      status: 'pending',
      visibility: 'private',
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!text) throw new Error('Failed to insert text row');

  const [chapter] = await db
    .insert(schema.textChapters)
    .values({
      textId: (text as Text).id,
      idx: 0,
      title: null,
      body,
      tokenCount: estimateTokenCount(body),
      createdAt: now,
    })
    .returning();
  if (!chapter) throw new Error('Failed to insert chapter row');

  return { text: text as Text, chapter: chapter as TextChapter };
}

/**
 * Read one of the user's own texts plus its chapters, in order. Used by
 * the placeholder reader page T-4.1 ships (a temporary view of the raw
 * body — the real reader lands in M5). Returns `null` if the text
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
