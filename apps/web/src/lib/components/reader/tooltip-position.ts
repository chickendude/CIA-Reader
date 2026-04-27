/**
 * Hover-tooltip positioning helper (T-5.10).
 *
 * The reader's hover tooltip appears above the focused word, centered
 * horizontally. If the word sits too close to the viewport edges we
 * flip the tooltip below or clamp it to a margin so it stays
 * fully visible. Pure function — no DOM access — so positioning is
 * unit-tested without rendering the component.
 */

export interface AnchorRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
  width: number;
  height: number;
}

export interface TooltipPlacement {
  top: number;
  left: number;
  /** Hint for the caller to flip the arrow if it draws one. */
  flipped: boolean;
}

const MARGIN = 8;

export function placeTooltip(
  anchor: AnchorRect,
  tipWidth: number,
  tipHeight: number,
  viewport: { width: number; height: number },
): TooltipPlacement {
  const center = anchor.left + anchor.width / 2;
  let left = center - tipWidth / 2;
  if (left < MARGIN) left = MARGIN;
  if (left + tipWidth > viewport.width - MARGIN) {
    left = viewport.width - MARGIN - tipWidth;
  }

  // Prefer above. If above clips, fall through to below.
  let top = anchor.top - tipHeight - MARGIN;
  let flipped = false;
  if (top < MARGIN) {
    top = anchor.bottom + MARGIN;
    flipped = true;
    // If below also clips, clamp to bottom margin.
    if (top + tipHeight > viewport.height - MARGIN) {
      top = Math.max(MARGIN, viewport.height - MARGIN - tipHeight);
    }
  }

  return { top, left, flipped };
}
