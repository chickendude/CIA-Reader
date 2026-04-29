export type AlignmentListItem = {
  tokenId: string;
  startMs: number;
  endMs: number;
};

/**
 * Pure binary search over a startMs-sorted alignment list. Returns the index
 * of the alignment containing `currentMs`, or null when no alignment covers
 * that timestamp.
 */
export function findAlignmentAt(
  alignments: AlignmentListItem[],
  currentMs: number,
): number | null {
  let lo = 0;
  let hi = alignments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const a = alignments[mid]!;
    if (currentMs < a.startMs) hi = mid - 1;
    else if (currentMs > a.endMs) lo = mid + 1;
    else return mid;
  }
  // Not inside any range, but keep highlighting the most recent word so
  // small gaps between alignments do not blink the highlight off.
  let best: number | null = null;
  for (let i = 0; i < alignments.length; i++) {
    if (alignments[i]!.startMs <= currentMs) best = i;
    else break;
  }
  return best;
}
