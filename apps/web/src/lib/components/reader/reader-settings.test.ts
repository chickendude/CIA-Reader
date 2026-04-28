// @vitest-environment node
/**
 * Tests for the reader-settings helpers (T-5.1b).
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_READER_SETTINGS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  LINE_SPACING_MAX,
  LINE_SPACING_MIN,
  READING_WIDTH_REM,
  WORDS_PER_PAGE_MAX,
  WORDS_PER_PAGE_MIN,
  clampReaderSettings,
  recommendedFontsFor,
  settingsDiff,
} from './reader-settings.js';

describe('clampReaderSettings', () => {
  it('clamps fontSize / lineSpacing / wordsPerPage into their allowed ranges', () => {
    const r = clampReaderSettings({
      ...DEFAULT_READER_SETTINGS,
      fontSize: 9,
      lineSpacing: 0.5,
      wordsPerPage: 5,
    });
    expect(r.fontSize).toBe(FONT_SIZE_MIN);
    expect(r.lineSpacing).toBe(LINE_SPACING_MIN);
    expect(r.wordsPerPage).toBe(WORDS_PER_PAGE_MIN);
  });

  it('clamps an over-range value to the upper bound', () => {
    const r = clampReaderSettings({
      ...DEFAULT_READER_SETTINGS,
      fontSize: 99,
      lineSpacing: 5,
      wordsPerPage: 9999,
    });
    expect(r.fontSize).toBe(FONT_SIZE_MAX);
    expect(r.lineSpacing).toBe(LINE_SPACING_MAX);
    expect(r.wordsPerPage).toBe(WORDS_PER_PAGE_MAX);
  });

  it('rounds wordsPerPage to a whole integer', () => {
    const r = clampReaderSettings({
      ...DEFAULT_READER_SETTINGS,
      wordsPerPage: 247.6,
    });
    expect(r.wordsPerPage).toBe(248);
  });

  it('passes a valid setting through unchanged', () => {
    const r = clampReaderSettings(DEFAULT_READER_SETTINGS);
    expect(r).toEqual(DEFAULT_READER_SETTINGS);
  });
});

describe('settingsDiff', () => {
  it('returns an empty object when the two settings match', () => {
    expect(settingsDiff(DEFAULT_READER_SETTINGS, DEFAULT_READER_SETTINGS)).toEqual({});
  });

  it('returns only the fields that changed', () => {
    const next = {
      ...DEFAULT_READER_SETTINGS,
      fontSize: 22,
      readingWidth: 'wide' as const,
    };
    expect(settingsDiff(DEFAULT_READER_SETTINGS, next)).toEqual({
      fontSize: 22,
      readingWidth: 'wide',
    });
  });

  it('reports null fontFamily transitions explicitly', () => {
    const prev = { ...DEFAULT_READER_SETTINGS, fontFamily: 'Mukta' };
    const next = { ...DEFAULT_READER_SETTINGS, fontFamily: null };
    expect(settingsDiff(prev, next)).toEqual({ fontFamily: null });
  });
});

describe('recommendedFontsFor', () => {
  it('prepends a null option (= system default) ahead of the registry list', () => {
    const list = recommendedFontsFor('hi');
    expect(list[0]).toBeNull();
    expect(list.slice(1)).toEqual(
      expect.arrayContaining(['Noto Serif Devanagari', 'Mukta']),
    );
  });

  it('returns an Odia-specific shortlist for or', () => {
    const list = recommendedFontsFor('or');
    expect(list).toContain('Noto Sans Oriya');
    // Must not leak Devanagari fonts into Odia.
    expect(list).not.toContain('Mukta');
  });
});

describe('READING_WIDTH_REM', () => {
  it('orders narrow < medium < wide', () => {
    expect(READING_WIDTH_REM.narrow).toBeLessThan(READING_WIDTH_REM.medium);
    expect(READING_WIDTH_REM.medium).toBeLessThan(READING_WIDTH_REM.wide);
  });
});
