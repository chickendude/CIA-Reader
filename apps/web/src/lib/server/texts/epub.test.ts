import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';

import { EpubParseError, htmlToText, parseEpub } from './epub.js';

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
async function buildFixtureEpub(args: {
  chapters: Array<{ id: string; href: string; title: string; bodyHtml: string }>;
  /** Override fields for negative tests. */
  containerXml?: string;
  opfPath?: string;
  opfXml?: string;
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
  const manifest = args.chapters
    .map(
      (c) =>
        `<item id="${c.id}" href="${c.href}" media-type="application/xhtml+xml"/>`,
    )
    .join('\n');
  const spine = args.chapters.map((c) => `<itemref idref="${c.id}"/>`).join('\n');
  zip.file(
    opfPath,
    args.opfXml ??
      `<?xml version="1.0"?>
<package version="3.0">
  <manifest>${manifest}</manifest>
  <spine>${spine}</spine>
</package>`,
  );
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
    const chapters = await parseEpub(bytes);
    expect(chapters).toHaveLength(2);
    expect(chapters[0]!.title).toBe('Chapter One');
    expect(chapters[0]!.body).toBe('First paragraph.\n\nSecond paragraph.');
    expect(chapters[1]!.title).toBe('Chapter Two');
    expect(chapters[1]!.body).toContain('Heading');
    expect(chapters[1]!.body).toContain('Body of two.');
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
    const chapters = await parseEpub(bytes);
    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.title).toBe('Real');
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
    const chapters = await parseEpub(bytes);
    expect(chapters[0]!.title).toBe('Fallback Title');
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
