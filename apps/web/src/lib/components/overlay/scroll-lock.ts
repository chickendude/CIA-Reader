/**
 * Body-scroll lock for overlays (T-5.15).
 *
 * Designed to be safe under nesting — multiple overlays open at once
 * each call `lockScroll()` and the body only unlocks once every
 * caller has released its lock. Records the previous overflow + the
 * current scrollY so the page returns to where the user was on
 * unlock.
 */

let lockCount = 0;
let savedOverflow: string | null = null;
let savedScrollY = 0;

/** Disable body scroll. Returns a release function — call it on
 *  unmount to balance the lock. Idempotent under concurrent locks. */
export function lockScroll(): () => void {
  if (typeof document === 'undefined') return () => {};
  if (lockCount === 0) {
    savedOverflow = document.body.style.overflow;
    savedScrollY = window.scrollY;
    document.body.style.overflow = 'hidden';
  }
  lockCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockCount -= 1;
    if (lockCount <= 0) {
      lockCount = 0;
      document.body.style.overflow = savedOverflow ?? '';
      savedOverflow = null;
      window.scrollTo(0, savedScrollY);
    }
  };
}

/** Test-only — reset counter between assertions. Not exported from
 *  the package's public surface. */
export function __resetScrollLockForTests(): void {
  lockCount = 0;
  savedOverflow = null;
  savedScrollY = 0;
}
