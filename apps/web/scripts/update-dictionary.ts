/**
 * Pull + import the dictionary for ONE language in a single step.
 *
 *   pnpm dictionary:update eu                      # fetch + import every eu source
 *   pnpm dictionary:update eu --with-en-translations  # also the shared ~3GB English dump
 *   pnpm dictionary:update eu --skip-fetch         # import already-cached dumps only
 *
 * "Pull"  = run scripts/fetch-dictionary-sources.sh for each of the language's
 *           Kaikki dumps (idempotent; skips files that are still fresh).
 * "Update"= run the idempotent importer (upserts on language+source+source_id).
 *
 * The per-language Kaikki dumps are small. The English-Translations source
 * (kaikki-en-translations-*) filters one shared ~3GB English dump, so it is
 * opt-in via --with-en-translations rather than pulled by default.
 */
import { config as loadEnv } from 'dotenv';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { isSupportedLanguage, LANGUAGES } from '@ciareader/shared-types';

import * as schema from '../src/lib/server/db/schema.js';
import { dictionarySources } from '../src/lib/server/dictionary/sources/index.js';
import { DrizzleDictionaryRepo } from '../src/lib/server/dictionary/drizzle-repo.js';
import { runDictionaryImport } from '../src/lib/server/dictionary/runner.js';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..');
loadEnv({ path: resolve(webRoot, '.env') });

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://ciareader:ciareader@localhost:5432/ciareader';

/**
 * The fetch slug for a source. Bundled seeds have no upstream dump (null);
 * every en-translations-* importer reads the one shared English dump.
 */
function fetchSlugFor(name: string): string | null {
  if (!name.startsWith('kaikki-')) return null;
  if (name.startsWith('kaikki-en-translations')) return 'kaikki-en-translations';
  return name;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const lang = args.find((a) => !a.startsWith('-'));
  const withEnTranslations = args.includes('--with-en-translations');
  const skipFetch = args.includes('--skip-fetch');

  if (!lang) {
    console.error(
      'usage: pnpm dictionary:update <language> [--with-en-translations] [--skip-fetch]',
    );
    process.exit(1);
  }
  if (!isSupportedLanguage(lang)) {
    console.error(`unknown language '${lang}'. supported: ${Object.keys(LANGUAGES).join(', ')}`);
    process.exit(1);
  }

  const entries = dictionarySources.filter((e) => e.source.language === lang);
  if (entries.length === 0) {
    console.error(`no dictionary sources registered for '${lang}'`);
    process.exit(1);
  }

  const client = postgres(DATABASE_URL, { max: 4, idle_timeout: 5 });
  const db = drizzle(client, { schema });
  const repo = new DrizzleDictionaryRepo(db);

  console.log(
    `[update] ${LANGUAGES[lang].displayName} (${lang}) — ${entries.length} registered source(s)`,
  );
  try {
    for (const { name, source } of entries) {
      const isEnTranslations = name.startsWith('kaikki-en-translations');
      if (isEnTranslations && !withEnTranslations) {
        console.log(
          `[update] skip ${name} — shared ~3GB English dump; pass --with-en-translations to include`,
        );
        continue;
      }

      if (!skipFetch) {
        const slug = fetchSlugFor(name);
        if (slug) {
          console.log(`[fetch] ${name} (slug: ${slug})`);
          execFileSync('bash', ['scripts/fetch-dictionary-sources.sh', slug], {
            cwd: webRoot,
            stdio: 'inherit',
          });
        } else {
          console.log(`[fetch] ${name} — bundled seed, nothing to download`);
        }
      }

      console.log(`[import] ${name}`);
      const r = await runDictionaryImport(repo, source);
      console.log(
        `[import] ${r.sourceName} done — ` +
          `${r.lemmasCreated} created, ${r.lemmasUpdated} updated, ` +
          `${r.lemmasSkippedCuratorLocked} skipped (curator-locked); ` +
          `${r.translationsCreated} translations created, ${r.translationsUpdated} updated; ` +
          `${r.formsCreated} forms inserted`,
      );
    }
    console.log(`[update] done — ${LANGUAGES[lang].displayName} (${lang})`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
