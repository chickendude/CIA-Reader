/**
 * Cross-browser build for the Primeran subtitle-mining extension.
 *
 * Each script entry (background, content, the MAIN-world net-intercept shim, and
 * the popup/options page scripts) is bundled as a self-contained IIFE with
 * esbuild — content scripts can't be ES modules, and an IIFE bundle is the one
 * format that loads identically as a Chrome service worker, a Firefox event
 * page, and a classic content script. We then copy the HTML pages and write a
 * per-browser manifest into `dist/<browser>/`.
 *
 * Usage: node scripts/build.mjs <firefox|chrome|both> [--watch]
 */
import { build, context } from 'esbuild';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildManifest } from './manifest.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const arg = process.argv[2] ?? 'both';
const watch = process.argv.includes('--watch');
const browsers = arg === 'both' ? ['firefox', 'chrome'] : [arg];

const ENTRY_POINTS = {
  background: 'src/background/index.ts',
  content: 'src/content/index.ts',
  'net-intercept': 'src/page-inject/net-intercept.ts',
  popup: 'src/popup/popup.ts',
  options: 'src/options/options.ts',
};

async function buildBrowser(browser) {
  const outdir = resolve(root, 'dist', browser);
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });

  const buildOptions = {
    entryPoints: Object.fromEntries(
      Object.entries(ENTRY_POINTS).map(([name, file]) => [name, resolve(root, file)]),
    ),
    outdir,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome111', 'firefox115'],
    sourcemap: watch ? 'inline' : false,
    minify: !watch,
    logLevel: 'info',
    define: {
      __BROWSER__: JSON.stringify(browser),
    },
  };

  if (watch) {
    const ctx = await context(buildOptions);
    await ctx.rebuild();
    await ctx.watch();
  } else {
    await build(buildOptions);
  }

  // HTML pages (reference ./popup.js / ./options.js, copied flat).
  await cp(resolve(root, 'src/popup/popup.html'), resolve(outdir, 'popup.html'));
  await cp(resolve(root, 'src/options/options.html'), resolve(outdir, 'options.html'));

  await writeFile(
    resolve(outdir, 'manifest.json'),
    JSON.stringify(buildManifest(browser), null, 2),
  );

  console.log(`[build] ${browser} -> dist/${browser}`);
}

for (const browser of browsers) {
  if (browser !== 'firefox' && browser !== 'chrome') {
    console.error(`Unknown browser "${browser}". Use firefox | chrome | both.`);
    process.exit(1);
  }
  await buildBrowser(browser);
}

if (watch) {
  console.log('[build] watching for changes — press Ctrl+C to stop');
}
