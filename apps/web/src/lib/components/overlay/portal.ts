/**
 * Portal action — moves the host node to <body> so it escapes any
 * ancestor that creates a containing block for fixed-positioned
 * descendants (transform, filter, will-change, contain, …).
 *
 * The reader's page content uses `transform` for the page-flip slide,
 * which would otherwise pin the word side-panel's backdrop to that
 * translated, max-width-capped column instead of the viewport.
 */
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
