/**
 * Soft-keyboard inset tracker for the reader (T-5.1c).
 *
 * iOS Safari + most Android browsers expose `window.visualViewport`,
 * which reports the visible area after the soft keyboard is shown.
 * The classic `position: fixed` bottom-sheet sits behind the
 * keyboard otherwise — we set a `--reader-kb-inset` CSS variable on
 * the document so the Sheet (and any other UI that wants to react)
 * can lift itself above the keyboard with `bottom: var(--reader-kb-inset, 0)`.
 *
 * Pure module exports keep the API small for unit-testing the math:
 * the stateful side (window.visualViewport listeners) is in
 * `attachKeyboardInsetTracker`.
 */

/**
 * Compute the keyboard inset in CSS pixels — i.e. how far the bottom
 * of the visible viewport sits *above* the bottom of the layout
 * viewport. Zero when no keyboard is visible.
 */
export function computeKeyboardInset(layoutHeight: number, vv: {
  height: number;
  offsetTop: number;
} | null): number {
  if (!vv) return 0;
  const inset = layoutHeight - vv.height - vv.offsetTop;
  return inset > 0 ? Math.round(inset) : 0;
}

export type KeyboardInsetSink = (px: number) => void;

/**
 * Wire up resize / scroll listeners on `window.visualViewport` and
 * forward the computed inset to `sink`. Returns a teardown function
 * the caller's $effect runs on unmount.
 */
export function attachKeyboardInsetTracker(sink: KeyboardInsetSink): () => void {
  if (typeof window === 'undefined') return () => {};
  const vv = window.visualViewport;
  if (!vv) return () => {};
  function update() {
    sink(computeKeyboardInset(window.innerHeight, vv));
  }
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  // Seed immediately so the variable is populated before the first
  // keyboard event fires.
  update();
  return () => {
    vv.removeEventListener('resize', update);
    vv.removeEventListener('scroll', update);
  };
}
