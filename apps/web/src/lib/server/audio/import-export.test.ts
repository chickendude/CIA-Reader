// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  AlignmentImportError,
  matchWordsToTokens,
  parseWebVtt,
  parseWhisperJson,
  toWebVtt,
  toWhisperJson,
} from './import-export.js';

describe('parseWhisperJson', () => {
  it('flattens segments × words into a single timing list', () => {
    const out = parseWhisperJson({
      segments: [
        {
          words: [
            { word: 'hello', start: 0.0, end: 0.5 },
            { word: 'world', start: 0.5, end: 1.0 },
          ],
        },
        {
          words: [{ word: 'next', start: 1.5, end: 2.0 }],
        },
      ],
    });
    expect(out).toHaveLength(3);
    expect(out[2]?.word).toBe('next');
  });

  it('rejects a non-object payload', () => {
    expect(() => parseWhisperJson(null)).toThrow(AlignmentImportError);
  });

  it('rejects a payload without segments', () => {
    expect(() => parseWhisperJson({ words: [] })).toThrow(AlignmentImportError);
  });

  it('skips entries that are missing fields', () => {
    const out = parseWhisperJson({
      segments: [
        {
          words: [
            { word: 'good', start: 0, end: 1 },
            { word: 'bad', start: 'not a number' },
            { start: 2, end: 3 },
          ],
        },
      ],
    });
    expect(out).toHaveLength(1);
  });
});

describe('parseWebVtt', () => {
  it('parses well-formed WEBVTT cues into word timings', () => {
    const vtt = `WEBVTT

1
00:00:00.000 --> 00:00:00.500
hello

2
00:00:00.500 --> 00:00:01.000
world
`;
    const out = parseWebVtt(vtt);
    expect(out).toEqual([
      { word: 'hello', start: 0, end: 0.5 },
      { word: 'world', start: 0.5, end: 1 },
    ]);
  });

  it('rejects a non-WEBVTT file', () => {
    expect(() => parseWebVtt('not a vtt')).toThrow(AlignmentImportError);
  });
});

describe('matchWordsToTokens', () => {
  const tokens = [
    { id: 't0', isWord: true },
    { id: 't1', isWord: false },
    { id: 't2', isWord: true },
    { id: 't3', isWord: false },
    { id: 't4', isWord: true },
  ];

  it('pairs imported words with isWord tokens by index', () => {
    const r = matchWordsToTokens(
      [
        { word: 'a', start: 0, end: 0.5 },
        { word: 'b', start: 0.5, end: 1 },
        { word: 'c', start: 1, end: 1.5 },
      ],
      tokens,
    );
    expect(r.matched).toBe(3);
    expect(r.alignments.map((a) => a.tokenId)).toEqual(['t0', 't2', 't4']);
    expect(r.alignments[0]).toMatchObject({ startMs: 0, endMs: 500 });
  });

  it('truncates when more words than tokens', () => {
    const r = matchWordsToTokens(
      [
        { word: 'a', start: 0, end: 1 },
        { word: 'b', start: 1, end: 2 },
        { word: 'c', start: 2, end: 3 },
        { word: 'extra', start: 3, end: 4 },
      ],
      [
        { id: 't0', isWord: true },
        { id: 't1', isWord: true },
      ],
    );
    expect(r.matched).toBe(2);
    expect(r.imported).toBe(4);
    expect(r.available).toBe(2);
  });
});

describe('toWhisperJson + toWebVtt', () => {
  const rows = [
    { tokenId: 't0', startMs: 0, endMs: 500 },
    { tokenId: 't2', startMs: 500, endMs: 1500 },
  ];
  const surfaces = new Map([
    ['t0', 'hello'],
    ['t2', 'world'],
  ]);

  it('emits Whisper-shaped JSON', () => {
    const j = toWhisperJson(rows, surfaces);
    expect(j.segments[0]?.words).toEqual([
      { word: 'hello', start: 0, end: 0.5 },
      { word: 'world', start: 0.5, end: 1.5 },
    ]);
  });

  it('emits WebVTT round-trippable through parseWebVtt', () => {
    const vtt = toWebVtt(rows, surfaces);
    expect(vtt.startsWith('WEBVTT')).toBe(true);
    const parsed = parseWebVtt(vtt);
    expect(parsed[0]?.word).toBe('hello');
    expect(parsed[1]?.start).toBeCloseTo(0.5);
  });
});
