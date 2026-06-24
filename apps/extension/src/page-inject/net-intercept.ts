/**
 * MAIN-world network shim.
 *
 * Injected by the content script into the page's own JS context so it can see
 * the player's `fetch`/`XHR` calls. Primeran loads subtitles as a standalone
 * WebVTT file from its CDN; we watch for that request and forward its URL to the
 * content script via `window.postMessage`. No extension APIs exist here — this
 * runs as the page.
 */
(() => {
  const TAG = '[primeran-miner:net]';
  const VTT_RE = /\.vtt(\?|#|$)/i;

  function report(url: string | undefined): void {
    if (!url || !VTT_RE.test(url)) return;
    window.postMessage({ source: 'primeran-miner', kind: 'subtitle-url', url }, '*');
  }

  const origFetch = window.fetch;
  window.fetch = function (this: typeof window, ...args: Parameters<typeof fetch>) {
    try {
      const input = args[0];
      report(typeof input === 'string' ? input : input instanceof Request ? input.url : String(input));
    } catch {
      /* never let instrumentation break the page */
    }
    return origFetch.apply(this, args);
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL) {
    try {
      report(typeof url === 'string' ? url : url.toString());
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line prefer-rest-params
    return origOpen.apply(this, arguments as unknown as Parameters<typeof origOpen>);
  };

  console.info(TAG, 'installed');
})();
