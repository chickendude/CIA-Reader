import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';

import {
  EpubParseError,
  extractEpubLanguage,
  htmlToText,
  parseEpub,
} from './epub.js';

// -----------------------------------------------------------------------
// htmlToText
// -----------------------------------------------------------------------

describe('htmlToText', () => {
  it('preserves paragraph breaks across <p> boundaries', () => {
    const out = htmlToText('<p>One.</p><p>Two.</p>');
    expect(out).toBe('One.\n\nTwo.');
  });

  it('treats <br> as a single line break, not a paragraph', () => {
    const out = htmlToText('<p>Line one.<br/>Line two.</p>');
    expect(out).toBe('Line one.\nLine two.');
  });

  it('strips inline tags without leaving punctuation gaps', () => {
    const out = htmlToText('<p><em>Hello</em>, <strong>world</strong>!</p>');
    expect(out).toBe('Hello, world!');
  });

  it('drops <script> + <style> bodies entirely', () => {
    const out = htmlToText(
      '<p>Body.</p><script>alert(1)</script><style>p{color:red}</style>',
    );
    expect(out).toBe('Body.');
  });

  it('decodes the named + numeric entities EPUBs actually use', () => {
    expect(htmlToText('<p>A&amp;B &lt;C&gt; &quot;D&quot; &#39;E&#39; &nbsp;F</p>')).toBe(
      'A&B <C> "D" \'E\' F',
    );
    expect(htmlToText('<p>&#x0905;&#x0906;</p>')).toBe('अआ');
  });

  it('collapses runs of whitespace + blank lines', () => {
    expect(htmlToText('<p>One</p>\n\n\n<p>Two</p>')).toBe('One\n\nTwo');
    expect(htmlToText('<p>spaced     out</p>')).toBe('spaced out');
  });

  it('strips XML doctype + comments + processing instructions', () => {
    const out = htmlToText(
      '<?xml version="1.0"?><!DOCTYPE html><!-- a comment --><p>Body.</p>',
    );
    expect(out).toBe('Body.');
  });
});

// -----------------------------------------------------------------------
// parseEpub
// -----------------------------------------------------------------------

/**
 * Build a minimal valid EPUB archive on the fly so the tests don't
 * depend on a checked-in binary fixture. The shape mirrors what
 * Calibre / Sigil emit: META-INF/container.xml → content.opf → spine
 * of XHTML chapters under OEBPS/.
 */
type NavEntryFixture = {
  href: string;
  title: string;
  children?: NavEntryFixture[];
};
type NcxEntryFixture = {
  src: string;
  title: string;
  children?: NcxEntryFixture[];
};

function renderNavOl(entries: NavEntryFixture[]): string {
  const items = entries
    .map(
      (n) =>
        `<li><a href="${n.href}">${n.title}</a>${n.children && n.children.length > 0 ? `<ol>${renderNavOl(n.children)}</ol>` : ''}</li>`,
    )
    .join('\n');
  return items;
}

function renderNcxPoints(entries: NcxEntryFixture[]): string {
  return entries
    .map(
      (n, i) =>
        `<navPoint id="np-${i}-${Math.random().toString(36).slice(2, 6)}" playOrder="${i + 1}"><navLabel><text>${n.title}</text></navLabel><content src="${n.src}"/>${n.children && n.children.length > 0 ? renderNcxPoints(n.children) : ''}</navPoint>`,
    )
    .join('\n');
}

async function buildFixtureEpub(args: {
  chapters: Array<{ id: string; href: string; title: string; bodyHtml: string }>;
  /** Override fields for negative tests. */
  containerXml?: string;
  opfPath?: string;
  opfXml?: string;
  /** Optional `<dc:language>` value. Inserted into the OPF metadata when set. */
  language?: string;
  /**
   * Optional EPUB3 nav.xhtml content — when set, the manifest grows
   * an extra item declaring `properties="nav"` and the spine omits
   * the nav item. Each entry maps a chapter href → user-facing title;
   * the fixture builder renders these as `<a href>` links inside a
   * `<nav epub:type="toc"><ol>` block. Each entry may itself carry
   * `children` to produce a nested `<ol>` (used to exercise the
   * parent-section detection).
   */
  nav?: NavEntryFixture[];
  /**
   * Optional EPUB2 NCX content — when set, the manifest gains a
   * `toc.ncx` entry, the spine carries `toc="ncx"`, and a toc.ncx
   * file is written alongside content.opf. Each entry is rendered as
   * a `<navPoint>` with `<navLabel><text>` and `<content src>`. As
   * with `nav`, entries may carry `children` to produce nested
   * navPoints.
   */
  ncx?: NcxEntryFixture[];
}): Promise<Uint8Array> {
  const opfPath = args.opfPath ?? 'OEBPS/content.opf';
  const zip = new JSZip();
  zip.file(
    'mimetype',
    'application/epub+zip',
  );
  zip.file(
    'META-INF/container.xml',
    args.containerXml ??
      `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${opfPath}" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
  );
  const manifestEntries = args.chapters
    .map(
      (c) =>
        `<item id="${c.id}" href="${c.href}" media-type="application/xhtml+xml"/>`,
    );
  if (args.nav) {
    manifestEntries.push(
      `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    );
  }
  if (args.ncx) {
    manifestEntries.push(
      `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    );
  }
  const manifest = manifestEntries.join('\n');
  const spine = args.chapters.map((c) => `<itemref idref="${c.id}"/>`).join('\n');
  const spineOpen = args.ncx ? '<spine toc="ncx">' : '<spine>';
  const metadata = args.language
    ? `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:language>${args.language}</dc:language></metadata>`
    : '';
  zip.file(
    opfPath,
    args.opfXml ??
      `<?xml version="1.0"?>
<package version="3.0">
  ${metadata}
  <manifest>${manifest}</manifest>
  ${spineOpen}${spine}</spine>
</package>`,
  );
  if (args.nav) {
    const items = renderNavOl(args.nav);
    const navDir = opfPath.includes('/') ? opfPath.replace(/\/[^/]+$/, '') + '/' : '';
    zip.file(
      navDir + 'nav.xhtml',
      `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>nav</title></head>
<body>
  <nav epub:type="toc">
    <ol>${items}</ol>
  </nav>
</body>
</html>`,
    );
  }
  if (args.ncx) {
    const points = renderNcxPoints(args.ncx);
    const ncxDir = opfPath.includes('/') ? opfPath.replace(/\/[^/]+$/, '') + '/' : '';
    zip.file(
      ncxDir + 'toc.ncx',
      `<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>${points}</navMap>
</ncx>`,
    );
  }
  for (const c of args.chapters) {
    const dir = opfPath.includes('/') ? opfPath.replace(/\/[^/]+$/, '') + '/' : '';
    zip.file(
      dir + c.href,
      `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${c.title}</title></head>
<body>${c.bodyHtml}</body>
</html>`,
    );
  }
  return zip.generateAsync({ type: 'uint8array' });
}

describe('parseEpub — happy path', () => {
  it('returns chapters in spine order with title + plain-text body', async () => {
    const bytes = await buildFixtureEpub({
      chapters: [
        {
          id: 'ch1',
          href: 'ch1.xhtml',
          title: 'Chapter One',
          bodyHtml: '<p>First paragraph.</p><p>Second paragraph.</p>',
        },
        {
          id: 'ch2',
          href: 'ch2.xhtml',
          title: 'Chapter Two',
          bodyHtml: '<h1>Heading</h1><p>Body of two.</p>',
        },
      ],
    });
    const { chapters, language } = await parseEpub(bytes);
    expect(chapters).toHaveLength(2);
    expect(chapters[0]!.title).toBe('Chapter One');
    expect(chapters[0]!.body).toBe('First paragraph.\n\nSecond paragraph.');
    expect(chapters[1]!.title).toBe('Chapter Two');
    expect(chapters[1]!.body).toContain('Heading');
    expect(chapters[1]!.body).toContain('Body of two.');
    // No <dc:language> in this fixture → null.
    expect(language).toBeNull();
  });

  it('skips empty / whitespace-only chapters', async () => {
    const bytes = await buildFixtureEpub({
      chapters: [
        { id: 'nav', href: 'nav.xhtml', title: 'Nav', bodyHtml: '   ' },
        {
          id: 'real',
          href: 'real.xhtml',
          title: 'Real',
          bodyHtml: '<p>Actual body.</p>',
        },
      ],
    });
    const { chapters } = await parseEpub(bytes);
    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.title).toBe('Real');
  });

  it('sources chapter titles from EPUB3 nav.xhtml when present', async () => {
    // Chapter <title> tags are Calibre-style junk IDs; the publisher's
    // nav.xhtml carries the real names. The parser should prefer the
    // nav titles over the chapter file's own <title>.
    const bytes = await buildFixtureEpub({
      chapters: [
        {
          id: 'ch1',
          href: 'ch1.xhtml',
          title: 'c9',
          bodyHtml: '<p>Body of chapter one.</p>',
        },
        {
          id: 'ch2',
          href: 'ch2.xhtml',
          title: 'cG',
          bodyHtml: '<p>Body of chapter two.</p>',
        },
      ],
      nav: [
        { href: 'ch1.xhtml', title: 'The Compound Effect' },
        { href: 'ch2.xhtml#start', title: 'Habit Stacking' },
      ],
    });
    const { chapters } = await parseEpub(bytes);
    expect(chapters[0]!.title).toBe('The Compound Effect');
    // Fragment in the nav href is stripped before matching.
    expect(chapters[1]!.title).toBe('Habit Stacking');
  });

  it('sources chapter titles from EPUB2 toc.ncx when no nav.xhtml', async () => {
    const bytes = await buildFixtureEpub({
      chapters: [
        {
          id: 'ch1',
          href: 'ch1.xhtml',
          title: 'c9',
          bodyHtml: '<p>Body one.</p>',
        },
        {
          id: 'ch2',
          href: 'ch2.xhtml',
          title: 'cG',
          bodyHtml: '<p>Body two.</p>',
        },
      ],
      ncx: [
        { src: 'ch1.xhtml', title: 'Chapter One — Ncx' },
        { src: 'ch2.xhtml#section-1', title: 'Chapter Two — Ncx' },
      ],
    });
    const { chapters } = await parseEpub(bytes);
    expect(chapters[0]!.title).toBe('Chapter One — Ncx');
    expect(chapters[1]!.title).toBe('Chapter Two — Ncx');
  });

  it('falls back to chapter <title> when the nav entry is just a page-number marker', async () => {
    // Some publisher EPUBs (Hindi titles especially) populate the
    // nav with page-marker anchors like `<a href="...">5</a>`. Those
    // entries point at spine items with real content, but the link
    // text is unusable as a chapter title. The parser should fall
    // back to the chapter file's own <title> / heading in that case.
    const bytes = await buildFixtureEpub({
      chapters: [
        {
          id: 'pm1',
          href: 'p5.xhtml',
          title: 'एटॉमिक',
          bodyHtml:
            '<p>The definition of atomic habits is a small change…</p>',
        },
      ],
      nav: [{ href: 'p5.xhtml', title: '5' }],
    });
    const { chapters } = await parseEpub(bytes);
    expect(chapters[0]!.title).toBe('एटॉमिक');
  });

  it('returns null when both the nav title and the chapter <title> are junk identifiers', async () => {
    // Worst-case Calibre book: nav.xhtml says `<a>cJS</a>`, the
    // chapter file's <head><title> also says `c25`. Neither is
    // usable — the parser surfaces null so the upload pipeline can
    // render "Untitled" instead.
    const bytes = await buildFixtureEpub({
      chapters: [
        { id: 'ch1', href: 'ch1.xhtml', title: 'c25', bodyHtml: '<p>Body.</p>' },
      ],
      nav: [{ href: 'ch1.xhtml', title: 'cJS' }],
    });
    const { chapters } = await parseEpub(bytes);
    expect(chapters[0]!.title).toBeNull();
  });

  it('keeps the nav title when it has any non-digit characters (not a page marker)', async () => {
    // Real chapter titles in numbered series ("1.", "Ch 3", "Chapter 4")
    // contain words or punctuation alongside numbers and should NOT
    // be replaced by the chapter file's <title>.
    const bytes = await buildFixtureEpub({
      chapters: [
        {
          id: 'ch1',
          href: 'ch1.xhtml',
          title: 'Internal Calibre Id',
          bodyHtml: '<p>Body.</p>',
        },
      ],
      nav: [{ href: 'ch1.xhtml', title: '1. Compound Effect' }],
    });
    const { chapters } = await parseEpub(bytes);
    expect(chapters[0]!.title).toBe('1. Compound Effect');
  });

  it('falls back to <title> for spine items the nav doc does not list', async () => {
    const bytes = await buildFixtureEpub({
      chapters: [
        {
          id: 'ch1',
          href: 'ch1.xhtml',
          title: 'Chapter One Title',
          bodyHtml: '<p>Body one.</p>',
        },
        {
          id: 'ch2',
          href: 'ch2.xhtml',
          title: 'Chapter Two Title',
          bodyHtml: '<p>Body two.</p>',
        },
      ],
      // Nav only covers ch1; ch2 has to fall back to <title>.
      nav: [{ href: 'ch1.xhtml', title: 'From Nav' }],
    });
    const { chapters } = await parseEpub(bytes);
    expect(chapters[0]!.title).toBe('From Nav');
    expect(chapters[1]!.title).toBe('Chapter Two Title');
    // No nested nav, so every chapter's section is null.
    expect(chapters[0]!.section).toBeNull();
    expect(chapters[1]!.section).toBeNull();
  });

  it('extracts parent-section titles from a nested EPUB3 nav.xhtml', async () => {
    // Mirrors the Atomic Habits TOC: a flat list of chapter XHTML
    // files in the spine, but the nav nests them under Part headings.
    // The Part entries also point at a real spine file (the part
    // intro), so they're rendered as their own top-level chapters
    // with section=null; their child chapters carry the Part title.
    const bytes = await buildFixtureEpub({
      chapters: [
        { id: 'p1', href: 'part1.xhtml', title: 'p1', bodyHtml: '<p>Part 1 intro.</p>' },
        { id: 'c1', href: 'ch1.xhtml', title: 'c1', bodyHtml: '<p>Chapter 1.</p>' },
        { id: 'c2', href: 'ch2.xhtml', title: 'c2', bodyHtml: '<p>Chapter 2.</p>' },
        { id: 'p2', href: 'part2.xhtml', title: 'p2', bodyHtml: '<p>Part 2 intro.</p>' },
        { id: 'c3', href: 'ch3.xhtml', title: 'c3', bodyHtml: '<p>Chapter 3.</p>' },
      ],
      nav: [
        {
          href: 'part1.xhtml',
          title: 'Part 1: Foundations',
          children: [
            { href: 'ch1.xhtml', title: '1. Compound Effect' },
            { href: 'ch2.xhtml', title: '2. Identity' },
          ],
        },
        {
          href: 'part2.xhtml',
          title: 'Part 2: Make It Obvious',
          children: [
            { href: 'ch3.xhtml', title: '3. Cues' },
          ],
        },
      ],
    });
    const { chapters } = await parseEpub(bytes);
    expect(chapters.map((c) => c.title)).toEqual([
      'Part 1: Foundations',
      '1. Compound Effect',
      '2. Identity',
      'Part 2: Make It Obvious',
      '3. Cues',
    ]);
    expect(chapters.map((c) => c.section)).toEqual([
      null,
      'Part 1: Foundations',
      'Part 1: Foundations',
      null,
      'Part 2: Make It Obvious',
    ]);
  });

  it('extracts parent-section titles from a nested EPUB2 NCX', async () => {
    const bytes = await buildFixtureEpub({
      chapters: [
        { id: 'p1', href: 'part1.xhtml', title: 'p1', bodyHtml: '<p>Part 1 intro.</p>' },
        { id: 'c1', href: 'ch1.xhtml', title: 'c1', bodyHtml: '<p>Chapter 1.</p>' },
        { id: 'c2', href: 'ch2.xhtml', title: 'c2', bodyHtml: '<p>Chapter 2.</p>' },
      ],
      ncx: [
        {
          src: 'part1.xhtml',
          title: 'Part 1',
          children: [
            { src: 'ch1.xhtml', title: 'Ch 1' },
            { src: 'ch2.xhtml', title: 'Ch 2' },
          ],
        },
      ],
    });
    const { chapters } = await parseEpub(bytes);
    expect(chapters.map((c) => c.title)).toEqual(['Part 1', 'Ch 1', 'Ch 2']);
    expect(chapters.map((c) => c.section)).toEqual([null, 'Part 1', 'Part 1']);
  });

  it('falls back to a heading when the document has no <title>', async () => {
    const bytes = await buildFixtureEpub({
      chapters: [
        {
          id: 'h',
          href: 'h.xhtml',
          // We override the title slot but the parser only looks at the
          // <title> tag for that — by passing an empty title the
          // generated <head><title></title></head> stays empty and the
          // parser falls back to <h1>.
          title: '',
          bodyHtml: '<h2>Fallback Title</h2><p>Body.</p>',
        },
      ],
    });
    const { chapters } = await parseEpub(bytes);
    expect(chapters[0]!.title).toBe('Fallback Title');
  });
});

describe('parseEpub — dc:language extraction', () => {
  it('returns the primary BCP47 subtag, lowercased', async () => {
    const bytes = await buildFixtureEpub({
      language: 'hi',
      chapters: [
        { id: 'a', href: 'a.xhtml', title: 'A', bodyHtml: '<p>body.</p>' },
      ],
    });
    const { language } = await parseEpub(bytes);
    expect(language).toBe('hi');
  });

  it('strips region / script subtags (hi-IN → hi, mr-Deva → mr)', async () => {
    const a = await buildFixtureEpub({
      language: 'hi-IN',
      chapters: [
        { id: 'a', href: 'a.xhtml', title: 'A', bodyHtml: '<p>body.</p>' },
      ],
    });
    expect((await parseEpub(a)).language).toBe('hi');
    const b = await buildFixtureEpub({
      language: 'mr-Deva',
      chapters: [
        { id: 'a', href: 'a.xhtml', title: 'A', bodyHtml: '<p>body.</p>' },
      ],
    });
    expect((await parseEpub(b)).language).toBe('mr');
  });

  it('lowercases an uppercase tag', async () => {
    const bytes = await buildFixtureEpub({
      language: 'OR',
      chapters: [
        { id: 'a', href: 'a.xhtml', title: 'A', bodyHtml: '<p>body.</p>' },
      ],
    });
    expect((await parseEpub(bytes)).language).toBe('or');
  });

  it('returns null when <dc:language> is missing or empty', async () => {
    const bytes = await buildFixtureEpub({
      chapters: [
        { id: 'a', href: 'a.xhtml', title: 'A', bodyHtml: '<p>body.</p>' },
      ],
    });
    expect((await parseEpub(bytes)).language).toBeNull();
  });

  it('extracts language from a malformed OPF as long as chapters still parse', async () => {
    // Whitespace + capitalization weirdness; non-namespaced <language>
    // tag (older OPF flavors omit the dc: prefix).
    expect(extractEpubLanguage('<language>  HI  </language>')).toBe('hi');
    // Numeric entity → still works because we decode before splitting.
    expect(extractEpubLanguage('<dc:language>m&#114;</dc:language>')).toBe('mr');
    // Missing closing tag → no match, null.
    expect(extractEpubLanguage('<dc:language>hi')).toBeNull();
    // Empty tag → null, not ''.
    expect(extractEpubLanguage('<dc:language></dc:language>')).toBeNull();
  });
});

describe('parseEpub — error paths', () => {
  it('rejects a non-zip blob with a clear EpubParseError', async () => {
    await expect(parseEpub(new Uint8Array([1, 2, 3, 4]))).rejects.toBeInstanceOf(
      EpubParseError,
    );
  });

  it('rejects an archive missing META-INF/container.xml', async () => {
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip');
    const bytes = (await zip.generateAsync({ type: 'uint8array' })) as Uint8Array;
    await expect(parseEpub(bytes)).rejects.toBeInstanceOf(EpubParseError);
  });

  it('rejects an EPUB with an empty spine', async () => {
    const bytes = await buildFixtureEpub({
      chapters: [],
      // Build an OPF by hand because the fixture helper requires
      // chapters to populate the spine.
      opfXml: '<?xml version="1.0"?><package><manifest></manifest><spine></spine></package>',
    });
    await expect(parseEpub(bytes)).rejects.toBeInstanceOf(EpubParseError);
  });

  it('rejects an EPUB whose chapters are all empty / non-readable', async () => {
    const bytes = await buildFixtureEpub({
      chapters: [
        { id: 'ch1', href: 'ch1.xhtml', title: '', bodyHtml: '' },
        { id: 'ch2', href: 'ch2.xhtml', title: '', bodyHtml: '<style>x{}</style>' },
      ],
    });
    await expect(parseEpub(bytes)).rejects.toBeInstanceOf(EpubParseError);
  });
});
