# Primeran Subtitle Miner (browser extension)

Basque subtitle mining for [Primeran](https://primeran.eus): clickable
subtitles, dictionary look-ups parsed to lemma form, per-episode word-frequency, and
one-click Anki cards. A thin, **local-first** client of the CIA Reader backend.

- **Internal dictionary** is downloaded once and cached in IndexedDB → offline look-ups.
- **External dictionaries** (Elhuyar, Euskaltzaindia) are fetched directly by the
  extension and cached locally.
- The backend is touched only for **lemmatization** (`/api/v1/parse`) and the one-time
  **dictionary snapshot** (`/api/v1/dictionary/eu/export`).
- **Anki** cards are added live via AnkiConnect (`127.0.0.1:8765`).

## Stack

Vanilla TypeScript + DOM (no UI framework), bundled with **esbuild** into per-browser
IIFE bundles. Firefox-first, Chrome-compatible (MV3).

## Build

```sh
pnpm --filter @ciareader/extension build           # both browsers → dist/firefox, dist/chrome
pnpm --filter @ciareader/extension build:firefox
pnpm --filter @ciareader/extension build:chrome
```

## Load

- **Firefox**: `about:debugging` → This Firefox → Load Temporary Add-on → pick
  `dist/firefox/manifest.json`.
- **Chrome**: `chrome://extensions` → Developer mode → Load unpacked → pick `dist/chrome`.

After loading, open the extension's **Settings** to point it at your CIA Reader backend
and configure Anki. Add the extension's origin (`moz-extension://…` / `chrome-extension://…`)
to AnkiConnect's `webCorsOriginList`.

## Develop

```sh
pnpm --filter @ciareader/extension dev:firefox     # rebuild dist/firefox on change
pnpm --filter @ciareader/extension typecheck
pnpm --filter @ciareader/extension lint
pnpm --filter @ciareader/extension test
```
