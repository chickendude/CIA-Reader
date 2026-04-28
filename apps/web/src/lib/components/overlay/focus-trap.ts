/**
 * Focus trap for modal / sheet overlays (T-5.15).
 *
 * `activateFocusTrap(container)` returns a deactivator. While active:
 *   - Tab / Shift+Tab cycles focus inside `container` (it never leaves
 *     for the underlying page chrome).
 *   - The first focusable descendant receives focus immediately.
 *   - On deactivate, focus returns to the element that had it before.
 *
 * Kept dependency-free (no `focus-trap` npm package) so the bundle
 * stays small and the behavior is easy to audit. Pure DOM, no Svelte.
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function focusableDescendants(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute('disabled') && !el.matches('[aria-hidden="true"] *'),
  );
}

export interface FocusTrap {
  /** Stop trapping. Call this on unmount or when the overlay closes. */
  deactivate(): void;
}

export function activateFocusTrap(container: HTMLElement): FocusTrap {
  const previouslyFocused = document.activeElement as HTMLElement | null;

  function focusFirst() {
    const els = focusableDescendants(container);
    if (els.length > 0) els[0]!.focus();
    else container.focus();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const els = focusableDescendants(container);
    if (els.length === 0) {
      e.preventDefault();
      container.focus();
      return;
    }
    const first = els[0]!;
    const last = els[els.length - 1]!;
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey) {
      if (active === first || !container.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  // Container itself needs to be focusable as a fallback so we never
  // leave focus on a now-hidden element underneath.
  if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1');
  focusFirst();
  document.addEventListener('keydown', onKeydown, true);

  return {
    deactivate() {
      document.removeEventListener('keydown', onKeydown, true);
      // Restore focus only if we still have a sensible target.
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    },
  };
}
