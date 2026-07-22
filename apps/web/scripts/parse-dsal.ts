/**
 * Offline parse step: scraped DSAL HTML → data/dictionaries/<slug>/raw.jsonl.
 *
 *   pnpm dsal:parse dsal-molesworth
 *
 * Reads every cached response under <slug>/scrape/ (in manifest/file
 * order), parses, dedupes, assigns homograph ordinals, and writes the
 * JSONL artifact the dsal-* importers consume. Never touches the
 * network — a parser fix is a re-parse, not a re-scrape.
 */
import { readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { DSAL_SLUGS, findDsalConfig } from '../src/lib/server/dictionary/dsal/config.js';
import { parseDsalResultsHtml } from '../src/lib/server/dictionary/dsal/parse.js';
import {
  finalizeRecords,
  serializeDsalRecord,
} from '../src/lib/server/dictionary/dsal/records.js';
import { buildParseReport, type PerFileStats } from '../src/lib/server/dictionary/dsal/report.js';
import type { DsalRecord } from '../src/lib/server/dictionary/dsal/records.js';

const DATA_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'dictionaries');

function main(): void {
  const slug = process.argv[2];
  const config = slug ? findDsalConfig(slug) : undefined;
  if (!config) {
    console.error(`usage: pnpm dsal:parse <slug>   (slugs: ${DSAL_SLUGS.join(', ')})`);
    process.exit(1);
  }

  const scrapeDir = join(DATA_ROOT, config.slug, 'scrape');
  let files: string[];
  try {
    files = readdirSync(scrapeDir)
      .filter((f) => f.endsWith('.html'))
      .sort();
  } catch {
    console.error(`no scrape cache at ${scrapeDir} — run: pnpm dsal:scrape ${config.slug}`);
    process.exit(1);
  }
  if (files.length === 0) {
    console.error(`no cached responses in ${scrapeDir} — run: pnpm dsal:scrape ${config.slug}`);
    process.exit(1);
  }

  const perFile: PerFileStats[] = [];
  const raw: Array<Omit<DsalRecord, 'ord'>> = [];
  for (const fileName of files) {
    const html = readFileSync(join(scrapeDir, fileName), 'utf-8');
    const { records, stats } = parseDsalResultsHtml(html, config);
    raw.push(...records);
    perFile.push({ fileName, stats });
  }

  const { records, duplicatesDropped } = finalizeRecords(raw);
  const outPath = join(DATA_ROOT, config.slug, 'raw.jsonl');
  writeFileSync(`${outPath}.tmp`, records.map(serializeDsalRecord).join('\n') + '\n');
  renameSync(`${outPath}.tmp`, outPath);

  const report = buildParseReport(config, perFile, records.length, duplicatesDropped);
  for (const line of report.lines) console.log(line);
  console.log(`[parse] wrote ${records.length} records → ${outPath}`);
  for (const warning of report.warnings) console.warn(`[parse] WARNING: ${warning}`);
  if (report.warnings.length === 0) {
    console.log(`[parse] next: pnpm dictionary:import ${config.slug}`);
  }
}

main();
