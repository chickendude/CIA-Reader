/**
 * Minimal server-side EPUB parser (T-4.3).
 *
 * EPUB is a ZIP archive of XHTML chapters with a small XML manifest
 * describing chapter order. Pulling in a full epub library was
 * tempting, but everything we need lives in three places:
 *
 *   1. `META-INF/container.xml` — the only fixed entry point. It
 *      tells us the OPF path inside the zip.
 *   2. The OPF file's `<spine>` — the canonical chapter ordering, by
 *      id-reference into the `<manifest>` map.
 *   3. Each chapter's XHTML — the readable content. We strip tags
 *      ourselves, preserving paragraph breaks.
 *
 * Plain regex parsing is fine for these specific shapes because EPUB
 * authors aren't writing creative XML — they're emitting from
 * Calibre, Sigil, or a publisher pipeline that produces tightly
 * conventional structure. Anything weird enough to break the regex
 * would fail in real readers too.
 *
 * Output is a list of `{ title, body }` chapters in spine order. The
 * upload service feeds these straight into `text_chapters` rows
 * without going through the auto-splitter — EPUB chapters are
 * authored, not heuristic.
 */
import JSZip from 'jszip';

export class EpubParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EpubParseError';
  }
}

export type EpubChapter = {
  title: string | null;
  body: string;
};

const OPF_PATH_RE = /<rootfile\b[^>]*\bfull-path="([^"]+)"/i;
const MANIFEST_ITEM_RE = /<item\b([^>]*?)\/?>/gi;
const ATTR_RE = (name: string) => new RegExp(`\\b${name}="([^"]*)"`, 'i');
const SPINE_ITEMREF_RE = /<itemref\b[^>]*\bidref="([^"]+)"/gi;
const TITLE_TAG_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const HEADING_RE = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i;

function joinPath(base: string, rel: string): string {
  // EPUB hrefs are relative to the OPF file's directory. Resolve them
  // by hand — `URL` doesn't fit because zip entries aren't URLs.
  const lastSlash = base.lastIndexOf('/');
  const dir = lastSlash >= 0 ? base.slice(0, lastSlash + 1) : '';
  const combined = dir + rel;
  // Normalize `./` and `../` segments.
  const parts: string[] = [];
  for (const part of combined.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

/**
 * Decode the small set of HTML entities we encounter in EPUB text.
 * Numeric (`&#10;`, `&#x0a;`) and the named entities the spec
 * actually uses; anything more exotic gets dropped to its source
 * form, which is rarely present in published EPUBs anyway.
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Strip XHTML to plain text, preserving paragraph breaks.
 *
 * Block-level tags (`<p>`, `<div>`, `<br>`, headings) become a single
 * `\n` boundary; consecutive boundaries collapse to a paragraph break.
 * All other tags are removed entirely. Script / style content is
 * dropped before tag-stripping so nothing leaks into the body.
 */
export function htmlToText(html: string): string {
  let s = html;
  // Drop the document head wholesale — its <title> + <meta> would
  // otherwise leak into the visible text once we strip tags.
  s = s.replace(/<head\b[\s\S]*?<\/head>/gi, '');
  // Drop script + style content wholesale — they'd otherwise survive
  // as text once we strip tags.
  s = s.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<style\b[\s\S]*?<\/style>/gi, '');
  // Drop any leftover XML processing instructions, doctypes, comments.
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<\?[\s\S]*?\?>/g, '');
  s = s.replace(/<!DOCTYPE[\s\S]*?>/gi, '');
  // Block-level boundaries → newline before/after.
  s = s.replace(/<\s*br\s*\/?\s*>/gi, '\n');
  s = s.replace(/<\/?\s*(p|div|section|article|li|ul|ol|h[1-6]|blockquote|pre|hr)\b[^>]*>/gi, '\n');
  // Strip remaining tags.
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  // Collapse runs of spaces / tabs (newlines are kept as paragraph
  // boundaries).
  s = s.replace(/[ \t]+/g, ' ');
  // Trim per line, then collapse 2+ blank lines → exactly one blank
  // line (so paragraph breaks survive intact for the chunker).
  s = s
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return s;
}

function extractFirstTitle(html: string): string | null {
  // Prefer the document <title> tag (Calibre puts the chapter name
  // there); fall back to the first heading inside the body.
  const t = TITLE_TAG_RE.exec(html);
  if (t) {
    const text = htmlToText(t[1]!).trim();
    if (text.length > 0) return text;
  }
  const h = HEADING_RE.exec(html);
  if (h) {
    const text = htmlToText(h[1]!).trim();
    if (text.length > 0) return text;
  }
  return null;
}

/**
 * Parse an EPUB blob into ordered `{ title, body }` chapters.
 *
 * `epubBytes` is the raw archive (ArrayBuffer / Uint8Array / Buffer).
 * Throws `EpubParseError` on malformed archives or missing OPF; the
 * caller maps it to a 400 with the message verbatim so the user knows
 * what went wrong with their file.
 */
export async function parseEpub(
  epubBytes: ArrayBuffer | Uint8Array,
): Promise<EpubChapter[]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(epubBytes);
  } catch (e) {
    throw new EpubParseError(
      `Could not open EPUB archive: ${(e as Error).message}`,
    );
  }

  const containerEntry = zip.file('META-INF/container.xml');
  if (!containerEntry) {
    throw new EpubParseError('EPUB is missing META-INF/container.xml');
  }
  const containerXml = await containerEntry.async('string');
  const opfMatch = OPF_PATH_RE.exec(containerXml);
  if (!opfMatch) {
    throw new EpubParseError('EPUB container.xml does not point to an OPF file');
  }
  const opfPath = opfMatch[1]!;
  const opfEntry = zip.file(opfPath);
  if (!opfEntry) {
    throw new EpubParseError(`EPUB OPF file '${opfPath}' is missing from the archive`);
  }
  const opfXml = await opfEntry.async('string');

  // Build manifest map: id → { href, mediaType }.
  const manifest = new Map<string, { href: string; mediaType: string }>();
  let m: RegExpExecArray | null;
  while ((m = MANIFEST_ITEM_RE.exec(opfXml))) {
    const attrs = m[1] ?? '';
    const id = ATTR_RE('id').exec(attrs)?.[1];
    const href = ATTR_RE('href').exec(attrs)?.[1];
    const mediaType = ATTR_RE('media-type').exec(attrs)?.[1] ?? '';
    if (id && href) manifest.set(id, { href, mediaType });
  }

  // Read the spine — the only canonical chapter order.
  const spineIds: string[] = [];
  let s: RegExpExecArray | null;
  while ((s = SPINE_ITEMREF_RE.exec(opfXml))) {
    spineIds.push(s[1]!);
  }
  if (spineIds.length === 0) {
    throw new EpubParseError('EPUB spine is empty (no chapters to import)');
  }

  const chapters: EpubChapter[] = [];
  for (const id of spineIds) {
    const item = manifest.get(id);
    if (!item) continue;
    if (
      item.mediaType &&
      !item.mediaType.includes('xhtml') &&
      !item.mediaType.includes('html')
    ) {
      // Some EPUBs put nav.xhtml in the spine — keep XHTML-ish, skip
      // images / metadata / fonts.
      continue;
    }
    const chapterPath = joinPath(opfPath, item.href);
    const chapterEntry = zip.file(chapterPath);
    if (!chapterEntry) continue;
    const html = await chapterEntry.async('string');
    const title = extractFirstTitle(html);
    const body = htmlToText(html);
    if (body.trim().length === 0) {
      // Empty chapters (e.g. nav landmarks) are useless — skip them
      // rather than persisting placeholder rows.
      continue;
    }
    chapters.push({ title, body });
  }
  if (chapters.length === 0) {
    throw new EpubParseError(
      'EPUB contains no readable chapters (every spine item was empty or non-HTML)',
    );
  }
  return chapters;
}
