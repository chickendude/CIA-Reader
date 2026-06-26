/**
 * Manifest generator (MV3), shared by both browser targets.
 *
 * The only structural difference between Firefox and Chrome is the background
 * declaration — Chrome wants a `service_worker`, Firefox an event page via
 * `background.scripts` — plus Firefox's required `browser_specific_settings.gecko`
 * (the fixed add-on id gives a stable `moz-extension://<uuid>` origin, which you
 * add to AnkiConnect's webCorsOriginList).
 *
 * Host permissions cover: Primeran itself, its subtitle CDN, the external Basque
 * dictionaries the extension scrapes directly, AnkiConnect, and the CIA Reader
 * backend (localhost for dev; widen for a deployed backend). All cross-origin
 * fetches run from the background context, so these host permissions — not page
 * CORS — are what authorize them.
 */
const HOST_PERMISSIONS = [
  'https://primeran.eus/*',
  'https://*.primeran.eus/*',
  'https://hiztegiak.elhuyar.eus/*',
  'https://www.euskaltzaindia.eus/*',
  'http://127.0.0.1:8765/*',
  'http://localhost:5173/*',
  'http://127.0.0.1:5173/*',
  // Public production backend — set the backend URL to https://parhiba.com in
  // Settings to sync lookups, frequency, and personal translations with the app.
  'https://parhiba.com/*',
  'https://*.parhiba.com/*',
  // Required by tabs.captureVisibleTab for the Anki-card screenshot.
  '<all_urls>',
];

export function buildManifest(browser) {
  const manifest = {
    manifest_version: 3,
    name: 'Primeran Subtitle Miner',
    version: '0.0.1',
    description:
      'Migaku-style Basque subtitle mining for Primeran: clickable subtitles, dictionary look-ups, frequency, and Anki cards.',
    permissions: ['storage', 'tabs', 'webRequest'],
    host_permissions: HOST_PERMISSIONS,
    action: {
      default_title: 'Primeran Subtitle Miner',
      default_popup: 'popup.html',
    },
    options_ui: {
      page: 'options.html',
      open_in_tab: true,
    },
    content_scripts: [
      {
        matches: ['https://primeran.eus/*', 'https://*.primeran.eus/*'],
        js: ['content.js'],
        // document_start so our keyboard listener registers before the player's
        // (otherwise the player eats the arrow keys).
        run_at: 'document_start',
        // Top frame only — the player, <video>, and overlay all live in the top
        // document; all_frames would spawn a duplicate overlay in ad iframes.
        all_frames: false,
      },
    ],
  };

  if (browser === 'firefox') {
    manifest.background = { scripts: ['background.js'] };
    manifest.browser_specific_settings = {
      gecko: {
        id: 'primeran-miner@ciareader',
        strict_min_version: '115.0',
      },
    };
  } else {
    manifest.background = { service_worker: 'background.js' };
  }

  return manifest;
}
