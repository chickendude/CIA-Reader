/**
 * Phrase-create selection helpers (T-14.3a).
 *
 * The shift-click gesture in `ChapterBody.svelte` produces a
 * `[anchorIdx, targetIdx]` range over the chapter's tokens; this
 * helper validates the range and projects it to the surfaces +
 * idx range that `WordPopup` needs to drive its phrase-create
 * banner. Extracted as a pure function so the validation
 * (sentence-boundary refusal, MIN/MAX token count) can be tested
 * independently of the Svelte component plumbing.
 *
 * Sentence-boundary detection uses a regex over Devanagari /
 * Indic / Western sentence-ending marks. The resolver in T-14.2
 * remains the source of truth on the server; this is a client-
 * side preflight so a user gets immediate feedback rather than
 * "the phrase saved but never shows up".
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
 * Validate the user's shift-click range against:
 *  - same-token rejection (single-token isn't a phrase),
 *  - MIN / MAX token count (2..8 — matches `phrases.ts`),
 *  - sentence-boundary refusal — any non-word token *between*
 *    the anchor and the target whose surface contains a
 *    sentence-ending mark fails the selection.
 *
 * `tokens` should be the full chapter token list in idx order;
 * the helper iterates over it to gather surfaces. Punctuation
 * tokens between anchor and target are skipped from the
 * surfaces list (the matcher in T-14.2 only matches words).
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
