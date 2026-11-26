import { describe, expect, it } from 'vitest';

import { buildReaderAnchorUrl } from './url-anchor.js';

const BASE = 'https://app.test/reader/t1';

describe('buildReaderAnchorUrl', () => {
  it('writes mode, chapter and token', () => {
    const out = new URL(
      buildReaderAnchorUrl(BASE, {
        mode: 'page',
        chapterIdx: 0,
        tokenIdx: 0,
        showRomanization: false,
      }),
    );
    expect(out.searchParams.get('mode')).toBe('page');
    expect(out.searchParams.get('chapterNumber')).toBe('1');
    expect(out.searchParams.get('token')).toBe('0');
    expect(out.searchParams.has('roman')).toBe(false);
  });

  it('rewrites an old chapter index when sharing the current passage', () => {
    const url = new URL(buildReaderAnchorUrl(`${BASE}?chapter=10`, {
      mode: 'page', chapterIdx: 10, tokenIdx: 4005, showRomanization: false,
    }));
    expect(url.searchParams.has('chapter')).toBe(false);
    expect(url.searchParams.get('chapterNumber')).toBe('11');
    expect(url.searchParams.get('token')).toBe('4005');
  });

  it('uses the text ID and token for a standalone collection chapter', () => {
    const url = new URL(buildReaderAnchorUrl(`${BASE}?chapterNumber=1`, {
      mode: 'page', chapterIdx: null, tokenIdx: 42, showRomanization: false,
    }));
    expect(url.searchParams.has('chapterNumber')).toBe(false);
    expect(url.searchParams.get('token')).toBe('42');
  });

  it('strips the one-shot endOfChapter handoff so a refresh resumes by token', () => {
    // Arrived via cross-text "prev" (opened at the last page), then paged back
    // to the first page (token 0). The mirrored URL must drop endOfChapter, or
    // a refresh would re-jump to the last page.
    const out = new URL(
      buildReaderAnchorUrl(`${BASE}?mode=page&endOfChapter=1`, {
        mode: 'page',
        chapterIdx: 0,
        tokenIdx: 0,
        showRomanization: false,
      }),
    );
    expect(out.searchParams.has('endOfChapter')).toBe(false);
    expect(out.searchParams.get('token')).toBe('0');
  });

  it('toggles the roman flag with showRomanization', () => {
    const on = new URL(
      buildReaderAnchorUrl(`${BASE}?roman=1`, {
        mode: 'page',
        chapterIdx: 2,
        tokenIdx: 40,
        showRomanization: true,
      }),
    );
    expect(on.searchParams.get('roman')).toBe('1');
    const off = new URL(
      buildReaderAnchorUrl(`${BASE}?roman=1`, {
        mode: 'page',
        chapterIdx: 2,
        tokenIdx: 40,
        showRomanization: false,
      }),
    );
    expect(off.searchParams.has('roman')).toBe(false);
  });

  it('preserves unrelated query params', () => {
    const out = new URL(
      buildReaderAnchorUrl(`${BASE}?ref=share&endOfChapter=1`, {
        mode: 'paged_scroll',
        chapterIdx: 1,
        tokenIdx: 99,
        showRomanization: false,
      }),
    );
    expect(out.searchParams.get('ref')).toBe('share');
    expect(out.searchParams.get('mode')).toBe('paged_scroll');
    expect(out.searchParams.get('token')).toBe('99');
    expect(out.searchParams.has('endOfChapter')).toBe(false);
  });
});
