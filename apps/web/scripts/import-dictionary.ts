/**
 * Dictionary import runner (T-3.10 rewrite).
 *
 * Replaces the original .mjs script which inlined the Hindi seed
 * because it couldn't import TS directly. With `tsx` in devDeps, this
 * script imports the same `runDictionaryImport` and source modules the
 * production code uses, so adding a new importer is one entry in
 * `sources/index.ts` and nothing else.
 *
 *   pnpm dictionary:import              # run every registered source
 *   pnpm dictionary:import kaikki-hindi # run just one
 *   pnpm dictionary:import --list       # show available sources
 *
 * The runner is idempotent — re-running upserts on
 * `(language, source, source_id)` and writes a `dictionary_imports`
 * audit row each run.
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '../src/lib/server/db/schema.js';
import { dictionarySources, findSource } from '../src/lib/server/dictionary/sources/index.js';
import { DrizzleDictionaryRepo } from '../src/lib/server/dictionary/drizzle-repo.js';
import { runDictionaryImport } from '../src/lib/server/dictionary/runner.js';

loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

// The runtime `db/index.ts` reads its DATABASE_URL through SvelteKit's
// `$env/dynamic/private`, which only resolves inside a SvelteKit
// process. This standalone script wires its own postgres-js client off
// `process.env` so it can run via `tsx` from any shell.
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://ciareader:ciareader@localhost:5432/ciareader';

const client = postgres(DATABASE_URL, { max: 4, idle_timeout: 5 });
const db = drizzle(client, { schema });
const repo = new DrizzleDictionaryRepo(db);

function listSources(): void {
  console.log('Available dictionary sources:');
  for (const { name, source } of dictionarySources) {
    console.log(`  ${name.padEnd(20)} ${source.language}  ${source.license}`);
  }
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (arg === '--list' || arg === '-l') {
    listSources();
    return;
  }

  const sourcesToRun = arg
    ? [{ name: arg, source: findSource(arg) }]
    : dictionarySources;

  for (const { name, source } of sourcesToRun) {
    if (!source) {
      console.error(
        `unknown source '${name}'. available: ${dictionarySources
          .map((e) => e.name)
          .join(', ')}`,
      );
      process.exit(1);
    }
    console.log(`[import] running ${source.name} (${source.language})`);
    const result = await runDictionaryImport(repo, source);
    console.log(
      `[import] ${result.sourceName} done — ` +
        `${result.lemmasCreated} created, ${result.lemmasUpdated} updated, ` +
        `${result.lemmasSkippedCuratorLocked} skipped (curator-locked); ` +
        `${result.translationsCreated} translations created, ` +
        `${result.translationsUpdated} updated; ${result.formsCreated} forms inserted`,
    );
  }
}

main()
  .then(() => client.end())
  .catch((e) => {
    console.error(e);
    void client.end();
    process.exit(1);
  });
