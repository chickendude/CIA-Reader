/**
 * Chapter chunking for uploaded text (T-4.2).
 *
 * The reader (M5) loads one chapter at a time. A 500k-token novel
 * pasted as one chapter would force every read to fetch the whole
 * thing — so this module splits long bodies into multiple
 * `text_chapters` rows at write time.
 *
 * Two splitters share this entry point:
 *
 *  1. **Explicit delimiter splitter (always wins).** If the user
 *     inserted form-feeds (`\f`) or `---` lines, those are the
 *     intended chapter boundaries — we honor them and never auto-
 *     paragraph-split inside a user-marked chunk. This lets curators
 *     (and power users) get exact control. A `# Title` line at the
 *     top of a section becomes that chapter's `title`.
 *
 *  2. **Paragraph-boundary auto-splitter (fallback).** When no
 *     explicit delimiters are found AND the body exceeds the chunking
 *     threshold, we walk paragraphs (separated by blank lines) and
 *     pack them into chapters of roughly `targetChapterTokens` each.
 *     A paragraph is never split mid-word; we may overshoot the
 *     target slightly to preserve paragraph integrity.
 *
 * The output contract is a non-empty list of `{ idx, title, body,
 * tokenCount }` records. `body` is already NFC-normalized + CRLF-
 * flattened by the caller — this module is text-shape-agnostic.
 */

/**
 * Body sizes below this token estimate stay as a single chapter even
 * when no delimiters are present — chunking adds complexity that's
 * pointless for a short story or essay. Rough rule from M5's reader
 * design: ~50k tokens is the upper bound for a "single chapter" load.
 */
export const CHUNK_THRESHOLD_TOKENS = 50_000;

/**
 * Target tokens per auto-split chapter. Smaller than the threshold so
 * a barely-over-threshold body still splits into 3+ readable chapters,
 * not 2 lopsided ones.
 */
export const TARGET_CHAPTER_TOKENS = 8_000;

/**
 * Hard cap on the number of chapters we'll auto-create from one
 * upload. Stops a pathological 10-million-token paste (or a
 * mis-configured TARGET_CHAPTER_TOKENS) from inserting 100k chapter
 * rows. Real long novels (~500k tokens) split into ~62 chapters at
 * the target above — well under this cap.
 */
export const MAX_AUTO_CHAPTERS = 500;

export type ChapterDraft = {
  idx: number;
  title: string | null;
  body: string;
  tokenCount: number;
};

export type ChunkingOptions = {
  /** Override the default token threshold. Used by tests. */
  thresholdTokens?: number;
  /** Override the default per-chapter target. Used by tests. */
  targetChapterTokens?: number;
};

/**
 * Cheap whitespace tokenizer. Same heuristic as
 * `upload.estimateTokenCount` — both use it as a "we don't have NLP
 * yet" stand-in for the real lemma count the worker will produce
 * later. Devanagari / Odia paragraphs use spaces between words so
 * `split(/\s+/)` is a serviceable estimator.
 */
export function estimateTokenCount(body: string): number {
  const trimmed = body.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Ensure a chapter body starts with its title so the NLP pipeline
 * tokenizes the title alongside the rest of the content — that's
 * what makes title words clickable + known-word-tracked in the
 * reader, same as body words.
 *
 * Idempotent: when the body already opens with the title (e.g. an
 * EPUB whose `<h1>Title</h1>` survived `htmlToText` as the first
 * paragraph), we return the body unchanged. Without this, the
 * stored body would be `Title\n\nTitle\n\n…` — duplicated heading
 * in the reader AND duplicated tokens flowing into NLP.
 *
 * Normalizes to NFC + LF newlines either way so the prefix check
 * is comparing in the same shape the reader / NLP will see.
 */
export function prependTitleToBody(
  title: string | null,
  body: string,
): { body: string; tokenCount: number } {
  const normalizedBody = body.normalize('NFC').replace(/\r\n?/g, '\n');
  const t = (title ?? '').trim();
  if (t.length === 0) {
    return { body: normalizedBody, tokenCount: estimateTokenCount(normalizedBody) };
  }
  const leading = normalizedBody.trimStart();
  if (leading.startsWith(t)) {
    const rest = leading.slice(t.length);
    if (rest.length === 0 || /^\s/.test(rest)) {
      return {
        body: normalizedBody,
        tokenCount: estimateTokenCount(normalizedBody),
      };
    }
  }
  const next = `${t}\n\n${normalizedBody}`;
  return { body: next, tokenCount: estimateTokenCount(next) };
}

const EXPLICIT_DELIMITER_RE = /(?:^|\n)(?:\f|-{3,}\s*)(?=\n|$)/g;

function hasExplicitDelimiters(body: string): boolean {
  // Quick scan — we don't need the matches, just whether any exist.
  return /(?:^|\n)(?:\f|-{3,})\s*(?:\n|$)/.test(body);
}

/**
 * Pull a leading `# Title` line off a chapter body. Returns
 * `[title | null, remainingBody]`. The hash style is chosen to match
 * common Markdown intuition without dragging in a real Markdown
 * parser — the body is plain text everywhere else.
 */
function extractLeadingTitle(body: string): [string | null, string] {
  const match = /^[ \t]*#\s+(.+?)\s*\n+/.exec(body);
  if (!match) return [null, body];
  const title = match[1]!.trim();
  return [title.length > 0 ? title : null, body.slice(match[0].length)];
}

function splitOnExplicitDelimiters(body: string): ChapterDraft[] {
  // Reset lastIndex on the regex (it's a /g; we use it stateful).
  EXPLICIT_DELIMITER_RE.lastIndex = 0;
  const parts: string[] = [];
  let lastEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = EXPLICIT_DELIMITER_RE.exec(body))) {
    parts.push(body.slice(lastEnd, m.index));
    lastEnd = m.index + m[0].length;
  }
  parts.push(body.slice(lastEnd));

  const drafts: ChapterDraft[] = [];
  let nextIdx = 0;
  for (const raw of parts) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    const [title, remainder] = extractLeadingTitle(trimmed);
    drafts.push({
      idx: nextIdx,
      title,
      body: remainder.trim(),
      tokenCount: estimateTokenCount(remainder),
    });
    nextIdx += 1;
  }
  // If the user wrote a delimiter at the very top followed by a body,
  // we may have produced no usable chapter — fall back to a single
  // chapter so a malformed delimiter doesn't lose the upload.
  if (drafts.length === 0) {
    return [
      {
        idx: 0,
        title: null,
        body: body.trim(),
        tokenCount: estimateTokenCount(body),
      },
    ];
  }
  return drafts;
}

function splitIntoParagraphs(body: string): string[] {
  // Two or more consecutive newlines separate paragraphs.
  return body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function autoSplitByParagraphs(
  body: string,
  targetChapterTokens: number,
): ChapterDraft[] {
  const paragraphs = splitIntoParagraphs(body);
  const drafts: ChapterDraft[] = [];
  let buf: string[] = [];
  let bufTokens = 0;
  let nextIdx = 0;

  function flush(): void {
    if (buf.length === 0) return;
    const chapterBody = buf.join('\n\n');
    drafts.push({
      idx: nextIdx,
      title: null,
      body: chapterBody,
      tokenCount: estimateTokenCount(chapterBody),
    });
    nextIdx += 1;
    buf = [];
    bufTokens = 0;
  }

  for (const p of paragraphs) {
    const t = estimateTokenCount(p);
    // If a single paragraph already exceeds the target, it lands
    // alone in its own chapter — never split mid-paragraph (line
    // breaks in source text often carry semantic weight, e.g. verse).
    if (bufTokens > 0 && bufTokens + t > targetChapterTokens) {
      flush();
    }
    buf.push(p);
    bufTokens += t;
    if (drafts.length >= MAX_AUTO_CHAPTERS - 1) {
      // Reserve the last slot — anything left after this lands
      // as one big tail chapter rather than getting truncated.
      break;
    }
  }
  flush();
  if (drafts.length === 0) {
    // Body was effectively empty after paragraph parsing — preserve
    // whatever the caller gave us so the validation upstream catches
    // the empty-body case rather than us silently turning it into 0
    // chapters.
    return [
      {
        idx: 0,
        title: null,
        body: body.trim(),
        tokenCount: estimateTokenCount(body),
      },
    ];
  }
  return drafts;
}

/**
 * Top-level entry point. See file header for the algorithm.
 *
 * Always returns at least one chapter. Empty / whitespace-only bodies
 * are returned as a single empty chapter — the caller is expected to
 * have already rejected those at validation time.
 */
export function splitIntoChapters(
  body: string,
  options: ChunkingOptions = {},
): ChapterDraft[] {
  const threshold = options.thresholdTokens ?? CHUNK_THRESHOLD_TOKENS;
  const targetChapterTokens =
    options.targetChapterTokens ?? TARGET_CHAPTER_TOKENS;

  if (hasExplicitDelimiters(body)) {
    return splitOnExplicitDelimiters(body);
  }

  const totalTokens = estimateTokenCount(body);
  if (totalTokens <= threshold) {
    return [
      {
        idx: 0,
        title: null,
        body: body.trim(),
        tokenCount: totalTokens,
      },
    ];
  }
  return autoSplitByParagraphs(body, targetChapterTokens);
}
