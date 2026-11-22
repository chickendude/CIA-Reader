/** Mark the exact word occurrence when its mobile lookup closes. */
export function wordReturnOutline(body: HTMLElement, selectedId: string | undefined) {
  let outline: Animation | undefined;

  return {
    update(nextId: string | undefined) {
      const previousId = selectedId;
      selectedId = nextId;
      outline?.cancel();
      if (!previousId || nextId || !window.matchMedia('(width < 960px)').matches) return;

      // A dictionary edit can replace the original word element while the sheet is open.
      const word = body.querySelector<HTMLElement>(`[data-token-id="${CSS.escape(previousId)}"]`);
      const solid = { outline: '2px solid var(--accent, var(--color-accent))', outlineOffset: '-1px' };
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      outline = word?.animate(
        [solid, { ...solid, offset: 0.2 }, { ...solid, outline: '2px solid transparent' }],
        { duration: 1800, easing: reducedMotion ? 'steps(1, end)' : 'linear' },
      );
    },
    destroy() {
      outline?.cancel();
    },
  };
}
