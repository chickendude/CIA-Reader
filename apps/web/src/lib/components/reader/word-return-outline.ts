/** Mark the exact word occurrence when its mobile lookup closes. */
export function wordReturnOutline(body: HTMLElement, selectedId: string | undefined) {
  let outlines: Animation[] = [];
  function clear() {
    for (const outline of outlines) outline.cancel();
    outlines = [];
  }

  return {
    update(nextId: string | undefined) {
      const previousId = selectedId;
      selectedId = nextId;
      clear();
      if (!previousId || nextId || !window.matchMedia('(width < 960px)').matches) return;

      // A dictionary edit can replace the original word element while the sheet is open.
      const id = CSS.escape(previousId);
      const words = body.querySelectorAll<HTMLElement>(`[data-token-id="${id}"], [data-phrase-reading="${id}"]`);
      const solid = { outline: '2px solid var(--accent, var(--color-accent))', outlineOffset: '-1px' };
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      outlines = Array.from(words, word => word.animate(
        [solid, { ...solid, offset: 0.2 }, { ...solid, outline: '2px solid transparent' }],
        { duration: 1800, easing: reducedMotion ? 'steps(1, end)' : 'linear' },
      ));
    },
    destroy: clear,
  };
}
