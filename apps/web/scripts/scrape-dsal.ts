/**
 * Operator CLI for the DSAL scraper (see src/lib/server/dictionary/dsal/).
 *
 *   pnpm dsal:scrape dsal-molesworth                 # full alphabet sweep
 *   pnpm dsal:scrape dsal-molesworth --letters क,ख   # cheap probe
 *   pnpm dsal:scrape dsal-praharaj --delay-ms 3000
 *   pnpm dsal:scrape dsal-platts --force             # ignore cached responses
 *
 * Responses land under apps/web/data/dictionaries/<slug>/scrape/ (gitignored);
 * run `pnpm dsal:parse <slug>` afterwards to produce raw.jsonl.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { DSAL_SLUGS, findDsalConfig } from '../src/lib/server/dictionary/dsal/config.js';
import {
  DEFAULT_DELAY_MS,
  ScrapeAbortError,
  runScrape,
} from '../src/lib/server/dictionary/dsal/scrape.js';

const DATA_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'dictionaries');

function usage(): never {
  console.error('usage: pnpm dsal:scrape <slug> [--letters क,ख] [--force] [--delay-ms 2000]');
  console.error(`  slugs: ${DSAL_SLUGS.join(', ')}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const slug = args[0];
  if (!slug || slug.startsWith('--')) usage();
  const config = findDsalConfig(slug);
  if (!config) {
    console.error(`unknown slug '${slug}'`);
    usage();
  }

  let letters: string[] | undefined;
  let force = false;
  let delayMs = DEFAULT_DELAY_MS;
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === '--force') force = true;
    else if (arg === '--letters') letters = (args[++i] ?? '').split(',').filter(Boolean);
    else if (arg.startsWith('--letters=')) letters = arg.slice(10).split(',').filter(Boolean);
    else if (arg === '--delay-ms') delayMs = Number(args[++i]);
    else if (arg.startsWith('--delay-ms=')) delayMs = Number(arg.slice(11));
    else usage();
  }
  if (!Number.isFinite(delayMs) || delayMs < 500) {
    console.error('--delay-ms must be a number ≥ 500 — this scraper stays polite');
    process.exit(1);
  }

  const plannedCount = letters?.length ?? config.queryAlphabet.length;
  console.log(
    `[scrape] ${config.slug} (${config.citation}) — ${plannedCount} queries, ` +
      `${delayMs}ms between requests`,
  );

  try {
    const summary = await runScrape(config, {
      dataRoot: DATA_ROOT,
      letters,
      force,
      delayMs,
      log: (m) => console.log(m),
    });
    console.log(
      `[scrape] ${config.slug} done — ${summary.fetched} fetched ` +
        `(${(summary.totalBytes / 1024 / 1024).toFixed(1)} MB), ` +
        `${summary.skippedCached} already cached`,
    );
    console.log(`[scrape] next: pnpm dsal:parse ${config.slug}`);
  } catch (err) {
    if (err instanceof ScrapeAbortError) {
      console.error(`[scrape] ABORTED: ${err.message}`);
      console.error('[scrape] cached responses were kept; re-run later to resume');
      process.exit(2);
    }
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
