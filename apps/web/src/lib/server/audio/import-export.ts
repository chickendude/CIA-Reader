/**
 * Alignment import / export (T-9.6).
 *
 * Two formats:
 *
 *   - Whisper word-timestamps JSON. Compatible with the JSON the
 *     `whisper` Python CLI emits at `--word_timestamps True`:
 *
 *       {
 *         "segments": [
 *           {
 *             "words": [
 *               { "word": "hello", "start": 0.12, "end": 0.45 },
 *               ...
 *             ]
 *           }
 *         ]
 *       }
 *
 *   - WebVTT per-word cues. Each cue is a single word with
 *     start/end timestamps. WebVTT spec timestamp format
 *     `HH:MM:SS.mmm`.
 *
 * Matching back to `text_tokens.id`: we rely on word-order. The
 * importer takes the chapter's tokens in reading order, filters
 * to `is_word=true`, and pairs with the imported word list by
 * index. Any length mismatch is reported back so the caller
 * can decide whether to truncate or reject. The whisper format's
 * "word" string is informational; we don't fuzzy-match on it.
 */
import type { Alignment } from './types.js';

export type WordTiming = {
  /** Display surface from the source — purely informational. */
  word: string;
  /** Seconds. */
  start: number;
  end: number;
};

export type ImportFormat = 'whisper' | 'webvtt';

export class AlignmentImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlignmentImportError';
  }
}

/**
 * Parse a Whisper word-timestamps JSON document into a flat
 * WordTiming[]. Returns the words in document order.
 */
export function parseWhisperJson(payload: unknown): WordTiming[] {
  if (!payload || typeof payload !== 'object') {
    throw new AlignmentImportError('not a JSON object');
  }
  const segments = (payload as { segments?: unknown }).segments;
  if (!Array.isArray(segments)) {
    throw new AlignmentImportError('missing segments array');
  }
  const out: WordTiming[] = [];
  for (const seg of segments) {
    const words = (seg as { words?: unknown }).words;
    if (!Array.isArray(words)) continue;
    for (const w of words) {
      const word = (w as { word?: unknown }).word;
      const start = (w as { start?: unknown }).start;
      const end = (w as { end?: unknown }).end;
      if (
        typeof word !== 'string' ||
        typeof start !== 'number' ||
        typeof end !== 'number'
      ) {
        continue;
      }
      out.push({ word: word.trim(), start, end });
    }
  }
  return out;
}

const VTT_TIMESTAMP_RE =
  /^(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})/;

function vttToSeconds(h: string, m: string, s: string, ms: string): number {
  return (
    Number.parseInt(h, 10) * 3600 +
    Number.parseInt(m, 10) * 60 +
    Number.parseInt(s, 10) +
    Number.parseInt(ms, 10) / 1000
  );
}

/**
 * Parse a WebVTT document into a flat WordTiming[]. Each cue
 * becomes one word; the cue's payload (lines after the
 * timestamp) is the word string. Cues without a recognisable
 * timestamp are skipped quietly.
 */
export function parseWebVtt(text: string): WordTiming[] {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0 || !lines[0]!.startsWith('WEBVTT')) {
    throw new AlignmentImportError('not a WEBVTT file');
  }
  const out: WordTiming[] = [];
  for (let i = 1; i < lines.length; i++) {
    const m = VTT_TIMESTAMP_RE.exec(lines[i]!);
    if (!m) continue;
    const start = vttToSeconds(m[1]!, m[2]!, m[3]!, m[4]!);
    const end = vttToSeconds(m[5]!, m[6]!, m[7]!, m[8]!);
    // Cue payload is the first non-empty line after the timestamp.
    let payload = '';
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]!.trim();
      if (line === '') break;
      payload = payload ? `${payload} ${line}` : line;
    }
    if (payload) out.push({ word: payload.trim(), start, end });
  }
  return out;
}

/**
 * Pair imported word timings with the chapter's actual text_token
 * ids by reading-order index over isWord tokens. Returns the
 * per-token alignment list ready to PUT to the alignments
 * endpoint.
 */
export function matchWordsToTokens(
  words: WordTiming[],
  tokens: Array<{ id: string; isWord: boolean }>,
): {
  alignments: Alignment[];
  matched: number;
  imported: number;
  available: number;
} {
  const wordTokens = tokens.filter((t) => t.isWord);
  const n = Math.min(words.length, wordTokens.length);
  const alignments: Alignment[] = [];
  for (let i = 0; i < n; i++) {
    const w = words[i]!;
    const t = wordTokens[i]!;
    alignments.push({
      tokenId: t.id,
      startMs: Math.max(0, Math.round(w.start * 1000)),
      endMs: Math.max(0, Math.round(w.end * 1000)),
    });
  }
  return {
    alignments,
    matched: n,
    imported: words.length,
    available: wordTokens.length,
  };
}

/**
 * Convert in-DB alignments + per-token surfaces to a Whisper-
 * shaped JSON document for export.
 */
export function toWhisperJson(
  rows: Array<{ tokenId: string; startMs: number; endMs: number }>,
  surfaceById: Map<string, string>,
): { segments: Array<{ words: WordTiming[] }> } {
  const words: WordTiming[] = rows.map((r) => ({
    word: surfaceById.get(r.tokenId) ?? '',
    start: r.startMs / 1000,
    end: r.endMs / 1000,
  }));
  return { segments: [{ words }] };
}

function formatVttTimestamp(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

export function toWebVtt(
  rows: Array<{ tokenId: string; startMs: number; endMs: number }>,
  surfaceById: Map<string, string>,
): string {
  const lines: string[] = ['WEBVTT', ''];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const surface = surfaceById.get(r.tokenId) ?? '';
    lines.push(String(i + 1));
    lines.push(
      `${formatVttTimestamp(r.startMs)} --> ${formatVttTimestamp(r.endMs)}`,
    );
    lines.push(surface);
    lines.push('');
  }
  return lines.join('\n');
}
