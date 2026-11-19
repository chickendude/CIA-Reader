/**
 * Check the selection before the reader saves a phrase. A selection that crosses a sentence
 * boundary could never match during chapter processing.
 */
import type { ServerToken } from './types.js';

/** Sentence-ending marks across the three MVP scripts plus the
 *  Western punctuation that creeps in via translated content. */
export const SENTENCE_END_RE = /[।॥.!?]/u;

export type SelectionValidationResult =
  | {
      kind: 'ok';
      surfaces: string[];
      rangeIdx: { start: number; end: number };
    }
  | { kind: 'error'; message: string };

/**
 * Skip punctuation between the selected words so the selection matches the words used by the
 * phrase matcher.
 */
export function validatePhraseSelection(
  tokens: ServerToken[],
  anchorIdx: number,
  targetIdx: number,
): SelectionValidationResult {
  const lo = Math.min(anchorIdx, targetIdx);
  const hi = Math.max(anchorIdx, targetIdx);
  if (lo === hi) {
    return { kind: 'error', message: 'Select at least two words.' };
  }
  for (const t of tokens) {
    if (t.idx <= lo || t.idx >= hi) continue;
    if (!t.isWord && SENTENCE_END_RE.test(t.surface)) {
      return {
        kind: 'error',
        message: 'Phrases must stay within a sentence.',
      };
    }
  }
  const surfaces: string[] = [];
  for (const t of tokens) {
    if (t.idx < lo || t.idx > hi) continue;
    if (!t.isWord) continue;
    surfaces.push(t.surface);
  }
  if (surfaces.length < 2) {
    return { kind: 'error', message: 'Select at least two words.' };
  }
  if (surfaces.length > 8) {
    return { kind: 'error', message: 'Phrases cannot exceed 8 words.' };
  }
  return {
    kind: 'ok',
    surfaces,
    rangeIdx: { start: lo, end: hi },
  };
}
