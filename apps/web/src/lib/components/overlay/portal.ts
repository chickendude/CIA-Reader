/** Overlays attach to the body so transformed reader pages cannot clip them. */
export function portal(node: HTMLElement) {
  if (typeof document === 'undefined') return {};
  const target = document.body;
  target.appendChild(node);
  return {
    destroy() {
      if (node.parentNode === target) {
        target.removeChild(node);
      }
    },
  };
}
