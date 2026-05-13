import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';

import { parseChapterZip, ZipParseError } from './zip.js';

/**
 * Build a ZIP with the given entries on the fly so the tests don't
 * carry a checked-in binary fixture. Each entry is `name → utf8 body`
 * unless the caller passes a Uint8Array for binary content.
 */
async function buildZip(
  entries: Record<string, string | Uint8Array>,
): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, body] of Object.entries(entries)) {
    zip.file(name, body);
  }
  return zip.generateAsync({ type: 'uint8array' });
}

describe('parseChapterZip — happy path', () => {
  it('returns one chapter per .txt file, ordered by filename', async () => {
    const bytes = await buildZip({
      '02-body.txt': 'Body of chapter two.',
      '01-intro.txt': 'Intro chapter.',
      '03-end.txt': 'Ending chapter.',
    });
    const chapters = await parseChapterZip(bytes);
    expect(chapters).toHaveLength(3);
    expect(chapters[0]!.title).toBe('01-intro');
    expect(chapters[0]!.body).toBe('Intro chapter.');
    expect(chapters[1]!.title).toBe('02-body');
    expect(chapters[2]!.title).toBe('03-end');
  });

  it('strips a UTF-8 BOM from the start of a chapter', async () => {
    const withBom = '﻿' + 'Body after BOM.';
    const bytes = await buildZip({ 'a.txt': withBom });
    const chapters = await parseChapterZip(bytes);
    expect(chapters[0]!.body).toBe('Body after BOM.');
  });

  it('promotes single newlines to paragraph breaks so each line renders separately', async () => {
    // CRLF and lone CR are normalized to LF first, then every newline
    // becomes a paragraph break — the reader only treats `\n\n+` as a
    // boundary, so without this every chapter would render as a wall
    // of text.
    const bytes = await buildZip({
      'a.txt': 'Line one.\r\nLine two.\rLine three.',
    });
    const chapters = await parseChapterZip(bytes);
    expect(chapters[0]!.body).toBe(
      'Line one.\n\nLine two.\n\nLine three.',
    );
  });

  it('leaves already-paragraphed content alone (no doubled blank lines)', async () => {
    const bytes = await buildZip({
      'a.txt': 'Para one.\n\nPara two.\n\nPara three.',
    });
    const chapters = await parseChapterZip(bytes);
    expect(chapters[0]!.body).toBe(
      'Para one.\n\nPara two.\n\nPara three.',
    );
  });

  it('returns a single chapter when only one .txt file is present', async () => {
    const bytes = await buildZip({ 'only.txt': 'Solo chapter.' });
    const chapters = await parseChapterZip(bytes);
    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.title).toBe('only');
  });
});

describe('parseChapterZip — what gets ignored', () => {
  it('ignores non-.txt files at the top level', async () => {
    const bytes = await buildZip({
      'a.txt': 'Real chapter.',
      'cover.jpg': new Uint8Array([0xff, 0xd8, 0xff]),
      'README.md': '# not a chapter',
    });
    const chapters = await parseChapterZip(bytes);
    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.title).toBe('a');
  });

  it('ignores .txt files inside subdirectories', async () => {
    const bytes = await buildZip({
      'top.txt': 'Top-level chapter.',
      'nested/inner.txt': 'Should be skipped.',
      'deep/deeper/deepest.txt': 'Also skipped.',
    });
    const chapters = await parseChapterZip(bytes);
    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.title).toBe('top');
  });

  it('skips .txt files that are empty or whitespace-only', async () => {
    const bytes = await buildZip({
      '01-blank.txt': '   \n\n   ',
      '02-real.txt': 'Has content.',
    });
    const chapters = await parseChapterZip(bytes);
    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.title).toBe('02-real');
  });

  it('is case-insensitive for the .txt suffix', async () => {
    const bytes = await buildZip({ 'STORY.TXT': 'Yelling.' });
    const chapters = await parseChapterZip(bytes);
    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.title).toBe('STORY');
  });
});

describe('parseChapterZip — error paths', () => {
  it('rejects a non-zip blob with a ZipParseError', async () => {
    await expect(
      parseChapterZip(new Uint8Array([1, 2, 3, 4])),
    ).rejects.toBeInstanceOf(ZipParseError);
  });

  it('rejects an empty zip', async () => {
    const bytes = await buildZip({});
    await expect(parseChapterZip(bytes)).rejects.toBeInstanceOf(ZipParseError);
  });

  it('rejects a zip with no top-level .txt files', async () => {
    const bytes = await buildZip({
      'nested/inner.txt': 'Should not save the upload.',
      'cover.jpg': new Uint8Array([0xff, 0xd8, 0xff]),
    });
    await expect(parseChapterZip(bytes)).rejects.toBeInstanceOf(ZipParseError);
  });

  it('rejects a .txt file that is not valid UTF-8', async () => {
    // 0xC3 0x28 is an invalid UTF-8 sequence (continuation byte
    // missing). Strict decoder throws, the parser surfaces a
    // ZipParseError naming the offending file.
    const bytes = await buildZip({ 'broken.txt': new Uint8Array([0xc3, 0x28]) });
    const err = await parseChapterZip(bytes).catch((e) => e);
    expect(err).toBeInstanceOf(ZipParseError);
    expect((err as ZipParseError).message).toContain('broken.txt');
  });
});
