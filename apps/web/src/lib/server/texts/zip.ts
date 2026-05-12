/**
 * ZIP-of-text-files parser for chapter-book uploads.
 *
 * EPUBs are great when the source has them, but they're also annoying
 * to author. This parser takes a plain ZIP whose top level holds a few
 * `.txt` files and returns one chapter per file, ordered by filename.
 * The chapter title comes from the filename minus extension; the body
 * is the UTF-8 decoded contents with BOM stripped and CRLF normalized.
 *
 * Convention (intentionally narrow for v1):
 *
 *   - Top-level `.txt` files only — anything in a subdirectory is
 *     ignored. (We don't want filesystem-zip viewers to silently
 *     bundle metadata folders.)
 *   - Order is lexicographic by filename. Users prefix
 *     `01-intro.txt`, `02-chapter-one.txt`, etc. — same trick that
 *     gets ePub authors to ordered spines.
 *   - One `.txt` file → caller's job to fall back to a plain text
 *     instead of a 1-item collection. This parser still returns the
 *     single chapter so the caller can branch.
 *
 * Future v2 might support a `manifest.json` for explicit titles and
 * order — left out for now per the implementation plan.
 */
import JSZip from 'jszip';

export class ZipParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipParseError';
  }
}

export type ZipChapter = {
  title: string | null;
  body: string;
};

/**
 * UTF-8 with strict decoding so a binary or mis-encoded file bubbles
 * up as a parse error rather than silently producing replacement
 * characters in the reader.
 */
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true });
/** UTF-8 BOM, removed if present at the start of a chapter file. */
const BOM = '﻿';

/**
 * Parse a ZIP archive into ordered chapters. See file header for the
 * accepted layout.
 *
 * Throws `ZipParseError` for any user-actionable problem (bad zip,
 * no `.txt` entries, undecodable file) — callers map it to a 400.
 */
export async function parseChapterZip(
  zipBytes: ArrayBuffer | Uint8Array,
): Promise<ZipChapter[]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(zipBytes);
  } catch (e) {
    throw new ZipParseError(
      `Could not open ZIP archive: ${(e as Error).message}`,
    );
  }

  // JSZip exposes both files and directory entries through `files`.
  // We want top-level `.txt` files only — `name` containing a `/`
  // means the entry is inside a folder, which we deliberately ignore.
  const entries = Object.values(zip.files).filter((f) => {
    if (f.dir) return false;
    if (f.name.includes('/')) return false;
    if (!f.name.toLowerCase().endsWith('.txt')) return false;
    return true;
  });

  if (entries.length === 0) {
    throw new ZipParseError(
      'ZIP contains no top-level .txt files (chapters must sit at the root)',
    );
  }

  // Lexicographic sort on filename. Locale-aware Intl.Collator would
  // surprise users who expect `01-foo.txt` to sort before `10-foo.txt`
  // — that's exactly what `string.localeCompare` with default locale
  // does, but we keep it simple with a plain compare since the
  // documented contract is "lexicographic." Users who want different
  // ordering rename their files; the v2 manifest path will replace
  // this entirely.
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const chapters: ZipChapter[] = [];
  for (const entry of entries) {
    let body: string;
    try {
      const bytes = (await entry.async('uint8array')) as Uint8Array;
      body = STRICT_UTF8.decode(bytes);
    } catch (e) {
      throw new ZipParseError(
        `'${entry.name}' is not valid UTF-8 text: ${(e as Error).message}`,
      );
    }
    if (body.startsWith(BOM)) body = body.slice(BOM.length);
    body = body.replace(/\r\n?/g, '\n');
    // Plain-text chapter files typically use one paragraph per line,
    // not the "blank line between paragraphs" convention pasted
    // content uses. The reader (and the chunker) only treat `\n\n+`
    // as a paragraph boundary — single `\n` collapses to whitespace —
    // so a file with line-per-paragraph would render as one wall of
    // text. Promote every newline to a paragraph break, then collapse
    // any runs we just created back down to exactly one blank line.
    // Files that already have `\n\n` separators end up unchanged.
    body = body.replace(/\n/g, '\n\n').replace(/\n{3,}/g, '\n\n');
    // Skip empty / whitespace-only files — matches the EPUB parser's
    // "nav landmark" skip so an accidental blank chapter doesn't
    // create a useless reader stub.
    if (body.trim().length === 0) continue;
    const title = entry.name.replace(/\.txt$/i, '').trim() || null;
    chapters.push({ title, body });
  }

  if (chapters.length === 0) {
    throw new ZipParseError(
      'ZIP contains no readable chapters (every .txt file was empty)',
    );
  }
  return chapters;
}
