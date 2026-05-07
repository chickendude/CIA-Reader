import { describe, expect, it } from 'vitest';

import {
  groupPendingSegments,
  segmentParagraphPhrases,
  type ChapterPhraseSpan,
  type ParagraphSegment,
  type ServerToken,
} from './types.js';

/**
 * Unit tests for `segmentParagraphPhrases` (T-14.3).
 *
 * The renderer in `ChapterBody.svelte` walks the segments and emits
 * either a bare `TokenSpan` or a `<phrase>` wrapper around a run of
 * `TokenSpan`s. These tests pin the segmentation invariants:
 *   - bare-token paragraphs round-trip when no spans match,
 *   - a single span produces one wrapped segment + bare flanks,
 *   - longest-wins picks the longer of two spans sharing a start,
 *   - shorter overlaps survive on the winner's `overlaps` list,
 *   - defensive bail-out when a span runs past the paragraph end.
 */

function tok(idx: number, surface: string): ServerToken {
  return {
    id: `t-${idx}`,
    idx,
    surface,
    isWord: true,
    isAmbiguous: false,
    isOov: false,
    lemmaId: null,
    romanization: null,
    glossDefault: null,
    personalGloss: null,
    candidates: [],
    features: {},
    numberForms: null,
    status: 'unknown',
  };
}

function span(
  phraseId: string,
  startTokenIdx: number,
  endTokenIdx: number,
): ChapterPhraseSpan {
  return {
    phraseId,
    startTokenIdx,
    endTokenIdx,
    glossDefault: null,
    status: 'unknown',
  };
}

describe('segmentParagraphPhrases', () => {
  it('returns a flat list of bare tokens when no spans match', () => {
    const paragraph = [tok(0, 'a'), tok(1, 'b'), tok(2, 'c')];
    const out = segmentParagraphPhrases(paragraph, []);
    expect(out).toHaveLength(3);
    expect(out.every((s) => s.kind === 'token')).toBe(true);
  });

  it('wraps a contiguous run when a span covers it', () => {
    const paragraph = [
      tok(0, 'a'),
      tok(1, 'इंतज़ार'),
      tok(2, 'करना'),
      tok(3, 'd'),
    ];
    const out = segmentParagraphPhrases(paragraph, [span('phr-1', 1, 2)]);
    // bare 'a', phrase wrapping idx 1+2, bare 'd'
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ kind: 'token', token: paragraph[0] });
    expect(out[1]?.kind).toBe('phrase');
    if (out[1]?.kind !== 'phrase') throw new Error('unreachable');
    expect(out[1].span.phraseId).toBe('phr-1');
    expect(out[1].tokens.map((t) => t.idx)).toEqual([1, 2]);
    expect(out[1].overlaps).toEqual([]);
    expect(out[2]).toEqual({ kind: 'token', token: paragraph[3] });
  });

  it('picks the longest span when two share a start (overlaps surface the rest)', () => {
    const paragraph = [tok(0, 'मदद'), tok(1, 'करना'), tok(2, 'है')];
    const out = segmentParagraphPhrases(paragraph, [
      span('phr-short', 0, 1),
      span('phr-long', 0, 2),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('phrase');
    if (out[0]?.kind !== 'phrase') throw new Error('unreachable');
    expect(out[0].span.phraseId).toBe('phr-long');
    expect(out[0].tokens.map((t) => t.idx)).toEqual([0, 1, 2]);
    expect(out[0].overlaps).toHaveLength(1);
    expect(out[0].overlaps[0]?.phraseId).toBe('phr-short');
  });

  it('emits multiple wrapped segments when the same phrase occurs twice', () => {
    const paragraph = [
      tok(0, 'इंतज़ार'),
      tok(1, 'करना'),
      tok(2, ','),
      tok(3, 'इंतज़ार'),
      tok(4, 'करना'),
    ];
    const out = segmentParagraphPhrases(paragraph, [
      span('phr-1', 0, 1),
      span('phr-1', 3, 4),
    ]);
    const phraseSegments = out.filter((s) => s.kind === 'phrase');
    expect(phraseSegments).toHaveLength(2);
  });

  it('falls back to bare tokens when a span endIdx falls outside the paragraph', () => {
    // Defensive case: e.g. the resolver wrote a span pointing at an
    // idx that no longer exists after a re-process. Renderer must
    // not crash and must continue with bare tokens.
    const paragraph = [tok(0, 'a'), tok(1, 'b')];
    const out = segmentParagraphPhrases(paragraph, [span('phr-x', 0, 99)]);
    expect(out.every((s) => s.kind === 'token')).toBe(true);
  });

  it('preserves token order across consecutive overlapping spans', () => {
    // Spans that touch end-to-end should still produce contiguous
    // bare-or-phrase output.
    const paragraph = [tok(0, 'a'), tok(1, 'b'), tok(2, 'c'), tok(3, 'd')];
    const out = segmentParagraphPhrases(paragraph, [
      span('phr-1', 0, 1),
      span('phr-2', 2, 3),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]?.kind).toBe('phrase');
    expect(out[1]?.kind).toBe('phrase');
  });
});

describe('groupPendingSegments (T-14.3b)', () => {
  it('returns every segment as plain when the range is null', () => {
    const segments: ParagraphSegment[] = [
      { kind: 'token', token: tok(0, 'a') },
      { kind: 'token', token: tok(1, 'b') },
    ];
    const out = groupPendingSegments(segments, null);
    expect(out).toEqual([
      { kind: 'plain', segment: segments[0] },
      { kind: 'plain', segment: segments[1] },
    ]);
  });

  it('brackets a contiguous run of in-range tokens under one pending group', () => {
    const segments: ParagraphSegment[] = [
      { kind: 'token', token: tok(0, 'a') },
      { kind: 'token', token: tok(1, 'b') },
      { kind: 'token', token: tok(2, 'c') },
      { kind: 'token', token: tok(3, 'd') },
    ];
    const out = groupPendingSegments(segments, { start: 1, end: 2 });
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ kind: 'plain', segment: segments[0] });
    expect(out[1]?.kind).toBe('pending');
    if (out[1]?.kind !== 'pending') throw new Error('unreachable');
    expect(out[1].segments).toEqual([segments[1], segments[2]]);
    expect(out[2]).toEqual({ kind: 'plain', segment: segments[3] });
  });

  it('groups a phrase segment when any of its tokens are in range', () => {
    const phraseSeg: ParagraphSegment = {
      kind: 'phrase',
      span: span('phr-x', 1, 2),
      tokens: [tok(1, 'इंतज़ार'), tok(2, 'करना')],
      overlaps: [],
    };
    const segments: ParagraphSegment[] = [
      { kind: 'token', token: tok(0, 'a') },
      phraseSeg,
      { kind: 'token', token: tok(3, 'd') },
    ];
    // Pending range starts mid-phrase — the whole phrase still
    // groups, since the phrase wrapper is the smallest renderable
    // unit and we'd otherwise have to break it mid-run.
    const out = groupPendingSegments(segments, { start: 2, end: 3 });
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ kind: 'plain', segment: segments[0] });
    expect(out[1]?.kind).toBe('pending');
    if (out[1]?.kind !== 'pending') throw new Error('unreachable');
    expect(out[1].segments).toEqual([phraseSeg, segments[2]]);
  });

  it('emits an empty list for an empty paragraph', () => {
    expect(groupPendingSegments([], { start: 0, end: 5 })).toEqual([]);
  });

  it('keeps an out-of-range segment plain even when range is set', () => {
    const segments: ParagraphSegment[] = [
      { kind: 'token', token: tok(0, 'a') },
    ];
    const out = groupPendingSegments(segments, { start: 5, end: 9 });
    expect(out).toEqual([{ kind: 'plain', segment: segments[0] }]);
  });
});
