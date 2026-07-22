/**
 * Auto-locate an entry on a scan page (assist, never a requirement).
 *
 * The workbench has the imported draft (headword + English senses) and
 * the page's cached OCR words. If a long-enough run of consecutive OCR
 * words matches the draft's first English sense, the entry almost
 * certainly sits there — union the matched boxes into a crop proposal
 * the curator can accept or redraw. Returning null is normal (bad OCR,
 * no draft, dense reuse of common words): the UI treats it as "draw it
 * yourself".
 */
import type { ScanCrop, ScanOcrWord } from '../db/schema.js';

export type CropProposal = { crop: ScanCrop; confidence: number };

const MIN_RUN = 3;
/** Padding added around the matched boxes, in page-normalized units —
 *  reaches left toward the (unmatched, non-Latin) headword column. */
const PAD_X = 0.04;
const PAD_Y = 0.015;

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

export function proposeCrop(
  ocrWords: ScanOcrWord[] | null | undefined,
  draft: { senseBodies: string[] },
): CropProposal | null {
  if (!ocrWords || ocrWords.length === 0) return null;
  const firstSense = draft.senseBodies.find((b) => /[A-Za-z]{3}/.test(b));
  if (!firstSense) return null;

  const target = firstSense.split(/\s+/).map(normalizeWord).filter((w) => w.length >= 2);
  if (target.length < MIN_RUN) return null;
  const page = ocrWords.map((w) => ({ ...w, norm: normalizeWord(w.s) }));

  // Longest run of consecutive OCR words matching a consecutive slice
  // of the target sense, tracked over every possible start alignment.
  let best: { start: number; length: number } | null = null;
  for (let i = 0; i < page.length; i += 1) {
    for (let j = 0; j < target.length; j += 1) {
      if (page[i]!.norm !== target[j] || page[i]!.norm.length === 0) continue;
      let length = 0;
      while (
        i + length < page.length &&
        j + length < target.length &&
        page[i + length]!.norm === target[j + length] &&
        page[i + length]!.norm.length > 0
      ) {
        length += 1;
      }
      if (length >= MIN_RUN && (best === null || length > best.length)) {
        best = { start: i, length };
      }
    }
  }
  if (!best) return null;

  const matched = page.slice(best.start, best.start + best.length);
  const x0 = Math.min(...matched.map((w) => w.x));
  const y0 = Math.min(...matched.map((w) => w.y));
  const x1 = Math.max(...matched.map((w) => w.x + w.w));
  const y1 = Math.max(...matched.map((w) => w.y + w.h));
  const crop: ScanCrop = {
    x: Math.max(0, x0 - PAD_X),
    y: Math.max(0, y0 - PAD_Y),
    w: Math.min(1, x1 + PAD_X) - Math.max(0, x0 - PAD_X),
    h: Math.min(1, y1 + PAD_Y) - Math.max(0, y0 - PAD_Y),
  };
  const confidence = Math.min(1, best.length / Math.min(10, target.length));
  return { crop, confidence };
}
