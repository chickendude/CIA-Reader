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
  /** Parent section heading from the publisher's nav doc (e.g. the
   *  "Part 1: Make It Obvious" entry that contains chapters 4–7).
   *  `null` when the chapter sits at the top level of the TOC, when
   *  the EPUB has no nav doc, or when the nav doesn't cover this
   *  particular spine item. */
  section: string | null;
};

/**
 * Result of `parseEpub`: ordered chapters + the OPF-declared language
 * (BCP47 primary subtag, lowercased; `null` if the EPUB omits the tag
 * or it can't be parsed). Callers use the language to verify the user
 * picked the right reader-language at upload time — see
 * `createChapterBookFromEpub` in `upload.ts`.
 */
export type ParsedEpub = {
  chapters: EpubChapter[];
  language: string | null;
};

const OPF_PATH_RE = /<rootfile\b[^>]*\bfull-path="([^"]+)"/i;
const MANIFEST_ITEM_RE = /<item\b([^>]*?)\/?>/gi;
const ATTR_RE = (name: string) => new RegExp(`\\b${name}="([^"]*)"`, 'i');
const SPINE_ITEMREF_RE = /<itemref\b[^>]*\bidref="([^"]+)"/gi;
const SPINE_TOC_RE = /<spine\b[^>]*\btoc="([^"]+)"/i;
const TITLE_TAG_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const HEADING_RE = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i;
// SAX-style tokenizer regexes — the nav parser walks these in
// document order and maintains a section stack so it can record
// each TOC entry's parent heading (e.g. "Part 1") alongside the
// entry's own title.
//
// EPUB3 nav.xhtml: <ol>/<li>/<a href="...">Title</a> with nesting
// for sub-sections. The toolkit captures every <ol>/<li> tag open
// + close so the walker can track depth.
const NAV_TOKEN_RE =
  /<(\/?)(ol|li)\b[^>]*>|<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
// EPUB2 NCX: <navPoint>/<navLabel><text>Title</text>/<content src> with
// nesting for hierarchical TOCs. Captures every navPoint open/close
// plus each (label, content) pair so the walker can track depth.
const NCX_TOKEN_RE =
  /<(\/?)navPoint\b[^>]*>|<navLabel\b[^>]*>[\s\S]*?<text\b[^>]*>([\s\S]*?)<\/text>[\s\S]*?<\/navLabel>\s*<content\b[^>]*\bsrc="([^"]+)"/gi;
// dc:language inside the OPF metadata. EPUB authors sometimes namespace
// it (`<dc:language>hi</dc:language>`) and sometimes don't
// (`<language>hi</language>`); accept both. Region/script subtags
// (`hi-IN`, `mr-Deva`) are normalized down to the primary subtag below.
const DC_LANGUAGE_RE = /<(?:dc:)?language\b[^>]*>([\s\S]*?)<\/(?:dc:)?language>/i;

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

/**
 * Pull `<dc:language>` out of the OPF metadata, lowercase it, and
 * return only the primary BCP47 subtag (so `hi-IN`, `mr-Deva`, and
 * `HI` all become `hi`). Returns `null` when the tag is missing or
 * empty — the upload pipeline treats that as "no claim, trust the
 * user's selection."
 */
export function extractEpubLanguage(opfXml: string): string | null {
  const m = DC_LANGUAGE_RE.exec(opfXml);
  if (!m) return null;
  const raw = decodeEntities(m[1] ?? '').trim();
  if (!raw) return null;
  const primary = raw.split(/[-_]/)[0]!.trim().toLowerCase();
  return primary.length > 0 ? primary : null;
}

/**
 * Heuristic: would this string be a sensible thing to show as a
 * chapter title in the library UI? Returns true for strings that
 * look like auto-generated identifiers — purely-digit page markers
 * (`"5"`, `"103"`) or short alphanumeric IDs (`"c25"`, `"cJS"`) that
 * many publisher/Calibre EPUBs embed in their nav docs and chapter
 * `<title>` tags. No human-authored chapter title is ever that
 * shape — the shortest real chapter names ("Intro", "Foreword") are
 * 5+ chars or include punctuation.
 */
function isJunkTitle(raw: string | null | undefined): boolean {
  if (!raw) return true;
  const t = raw.trim();
  if (t.length === 0) return true;
  // Purely-digits page-marker titles like "5", "103".
  if (/^\d+$/.test(t)) return true;
  // Calibre-style identifier: ≤4 chars, all alphanumeric (no spaces
  // or punctuation), AND containing either a digit or a
  // lowercase→uppercase case transition. The shape rules out real
  // short word-titles ("Intro", "Soup", "Real") while still flagging
  // `c9`, `c25`, `c2M`, `cG`, `cJS`, etc.
  if (
    t.length <= 4
    && /^[A-Za-z][A-Za-z0-9]*$/.test(t)
    && (/\d/.test(t) || /[a-z][A-Z]/.test(t))
  ) {
    return true;
  }
  return false;
}

function extractFirstTitle(html: string): string | null {
  // Per-file fallback once the navigation document has been
  // exhausted: prefer the document <title> tag — that's the
  // standard EPUB location for the chapter's user-facing name and
  // what publishers (and Sigil / InDesign exports) populate. Fall
  // back to the first body heading when <title> is missing or
  // empty.
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
 * Information sourced from the publisher's navigation document for
 * one chapter (spine item).
 */
type NavEntry = {
  /** Human-readable chapter title from the TOC entry. */
  title: string;
  /** Parent-section title from the TOC's hierarchy. `null` for
   *  top-level entries or flat TOCs. */
  section: string | null;
};

/**
 * Parse the navigation document — EPUB3 `nav.xhtml` (declared via
 * `properties="nav"` on its manifest item) or, as a fallback, an
 * EPUB2 NCX (referenced by the `<spine toc="ncx-id">` attribute).
 *
 * Returns a map of absolute-within-zip chapter path → `{ title,
 * section }`. The publisher's TOC is the most reliable source for
 * chapter names AND the only place that records the hierarchy
 * (Parts containing chapters, etc.) — we use it before consulting
 * the chapter file's own `<title>` or heading.
 *
 * Fragment identifiers (`#section`) are stripped — the spine
 * references whole files, not anchors. When the same chapter is
 * listed under multiple TOC entries (publisher subdivisions), the
 * first wins so the user gets the top-level chapter name on the
 * library card.
 */
async function loadNavTitles(args: {
  zip: JSZip;
  opfPath: string;
  opfXml: string;
  manifest: Map<string, { href: string; mediaType: string }>;
}): Promise<Map<string, NavEntry>> {
  const { zip, opfPath, opfXml, manifest } = args;
  const out = new Map<string, NavEntry>();

  // EPUB3 first: manifest item with `properties="nav"` (the property
  // list is space-separated, so we tokenize before checking).
  let navHref: string | null = null;
  let navIsNcx = false;
  let m: RegExpExecArray | null;
  while ((m = MANIFEST_ITEM_RE.exec(opfXml))) {
    const attrs = m[1] ?? '';
    const properties = (ATTR_RE('properties').exec(attrs)?.[1] ?? '')
      .split(/\s+/)
      .filter(Boolean);
    if (properties.includes('nav')) {
      navHref = ATTR_RE('href').exec(attrs)?.[1] ?? null;
      if (navHref) break;
    }
  }
  // Reset so a later spine-iteration pass over MANIFEST_ITEM_RE starts
  // from the top.
  MANIFEST_ITEM_RE.lastIndex = 0;

  // EPUB2 fallback: <spine toc="ncx-id">.
  if (!navHref) {
    const tocId = SPINE_TOC_RE.exec(opfXml)?.[1];
    if (tocId) {
      const ncxItem = manifest.get(tocId);
      if (ncxItem) {
        navHref = ncxItem.href;
        navIsNcx = true;
      }
    }
  }

  if (!navHref) return out;

  const navPath = joinPath(opfPath, navHref);
  const navEntry = zip.file(navPath);
  if (!navEntry) return out;
  const navXml = await navEntry.async('string');

  if (navIsNcx) {
    // SAX walk: each <navPoint> opens a level; the (label, content)
    // pair inside it identifies that level's TOC entry. Children of
    // a navPoint inherit the parent's title as their section.
    const sectionStack: (string | null)[] = [null];
    let p: RegExpExecArray | null;
    while ((p = NCX_TOKEN_RE.exec(navXml))) {
      const tagSlash = p[1];
      const labelText = p[2];
      const contentSrc = p[3];
      if (tagSlash !== undefined && labelText === undefined) {
        // <navPoint> or </navPoint>
        if (tagSlash === '/') {
          // Closing a navPoint pops its title off the section stack.
          if (sectionStack.length > 1) sectionStack.pop();
        } else {
          // Opening a navPoint — push a placeholder; the upcoming
          // navLabel will replace it.
          sectionStack.push(sectionStack[sectionStack.length - 1] ?? null);
        }
      } else if (labelText !== undefined && contentSrc !== undefined) {
        const title = htmlToText(labelText).trim();
        const hrefNoFrag = contentSrc.split('#')[0]!;
        if (!title || !hrefNoFrag) continue;
        // Section = the parent's title (the level above us in the
        // stack). The current level's slot is at top of stack and
        // we're about to overwrite it with this entry's title for
        // any nested children.
        const section = sectionStack.length >= 2
          ? sectionStack[sectionStack.length - 2]!
          : null;
        const resolved = joinPath(navPath, hrefNoFrag);
        if (!out.has(resolved)) out.set(resolved, { title, section });
        sectionStack[sectionStack.length - 1] = title;
      }
    }
    NCX_TOKEN_RE.lastIndex = 0;
  } else {
    // EPUB3 nav.xhtml. We walk every <ol>/<li> open + close plus each
    // <a href> and maintain a section stack indexed by <ol> depth:
    // sectionStack[d] is the title of the most recent <a> seen at
    // depth d. A new <a> at depth d records section = sectionStack[d-1].
    const sectionStack: (string | null)[] = [];
    let depth = 0;
    let a: RegExpExecArray | null;
    while ((a = NAV_TOKEN_RE.exec(navXml))) {
      const tagSlash = a[1];
      const tagName = a[2]?.toLowerCase();
      const href = a[3];
      const inner = a[4];
      if (tagName === 'ol') {
        if (tagSlash === '/') {
          depth = Math.max(0, depth - 1);
          if (sectionStack.length > depth) sectionStack.length = depth;
        } else {
          depth += 1;
          // Make sure the stack is long enough for this depth so
          // sectionStack[depth-1] reads back the parent's title.
          while (sectionStack.length < depth) sectionStack.push(null);
        }
      } else if (tagName === 'li') {
        // <li> tags don't change section depth — sections come from
        // <ol> nesting. No-op.
      } else if (href !== undefined && inner !== undefined) {
        const title = htmlToText(inner).trim();
        const hrefNoFrag = href.split('#')[0]!;
        if (!title || !hrefNoFrag) continue;
        const section =
          depth >= 2 ? sectionStack[depth - 2] ?? null : null;
        const resolved = joinPath(navPath, hrefNoFrag);
        if (!out.has(resolved)) out.set(resolved, { title, section });
        // This entry becomes the candidate section title for any
        // nested <ol> that follows inside the current <li>.
        if (depth >= 1) sectionStack[depth - 1] = title;
      }
    }
    NAV_TOKEN_RE.lastIndex = 0;
  }

  return out;
}

/**
 * Parse an EPUB blob into ordered chapters + the declared language.
 *
 * `epubBytes` is the raw archive (ArrayBuffer / Uint8Array / Buffer).
 * Throws `EpubParseError` on malformed archives or missing OPF; the
 * caller maps it to a 400 with the message verbatim so the user knows
 * what went wrong with their file.
 *
 * Language is read from `<dc:language>` in the OPF and normalized to
 * its primary BCP47 subtag (e.g. `hi-IN` → `hi`). When the tag is
 * absent we return `null` and let the caller fall back to the user's
 * dropdown selection.
 */
export async function parseEpub(
  epubBytes: ArrayBuffer | Uint8Array,
): Promise<ParsedEpub> {
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
  const language = extractEpubLanguage(opfXml);

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

  // Publisher-declared TOC — most authoritative source of chapter
  // titles AND the only place that records the parent-section
  // hierarchy. The per-chapter `<title>` / heading heuristic is the
  // fallback for items the nav doc doesn't cover.
  const navEntries = await loadNavTitles({ zip, opfPath, opfXml, manifest });

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
    const navEntry = navEntries.get(chapterPath);
    // Pick the first non-junk source: nav title → chapter file
    // <title>/heading → null (the caller renders "Untitled"). Both
    // sources can produce identifier-shaped garbage (page-marker
    // numbers, Calibre auto-IDs), so we filter each before taking
    // it. See `isJunkTitle` for the exact shape.
    const navTitle = navEntry?.title ?? null;
    const fileTitle = extractFirstTitle(html);
    const cleanNav = !isJunkTitle(navTitle) ? navTitle : null;
    const cleanFile = !isJunkTitle(fileTitle) ? fileTitle : null;
    const title = cleanNav ?? cleanFile;
    const section = navEntry?.section ?? null;
    const body = htmlToText(html);
    if (body.trim().length === 0) {
      // Empty chapters (e.g. nav landmarks) are useless — skip them
      // rather than persisting placeholder rows.
      continue;
    }
    chapters.push({ title, body, section });
  }
  if (chapters.length === 0) {
    throw new EpubParseError(
      'EPUB contains no readable chapters (every spine item was empty or non-HTML)',
    );
  }
  return { chapters, language };
}
