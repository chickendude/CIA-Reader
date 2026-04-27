// One-shot dictionary importer.
//
// Runs every available DictionaryImportSource against the live
// Postgres so the lemmas + translations tables are populated.
// Idempotent — re-running upserts on (language, source, source_id).
//
// Usage:
//   node apps/web/scripts/import-dictionary.mjs [hindi-seed]
//
// With no arg, runs every source. With a name, runs just that one.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '../');

// We use tsx-style dynamic import via the SvelteKit dev pipeline so
// `$lib` aliases resolve. The simplest path is to import the
// already-built sources and wire them against a small Drizzle client.
process.chdir(projectRoot);

// Load the drizzle client + schema directly, same env defaults as
// $lib/server/env.ts.
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://ciareader:ciareader@localhost:5432/ciareader';

const postgres = (await import('postgres')).default;
const { drizzle } = await import('drizzle-orm/postgres-js');
// schema.ts is a TypeScript file — Node can't import it directly.
// We read the SQL we need directly to keep this script dependency-
// light. The runner from src/lib/server/dictionary uses Drizzle, but
// for a one-shot we write idempotent SQL by hand.
const sql = postgres(DATABASE_URL, { max: 4, idle_timeout: 5 });

// Inline the entries that hindi-seed.ts exports. Kept identical to
// the source-of-truth file at apps/web/src/lib/server/dictionary/
// sources/hindi-seed.ts — touch one, mirror the other.
const HINDI_SEED = {
  name: 'hindi-seed',
  language: 'hi',
  attribution: 'CIA Reader Hindi seed (public domain)',
  entries: [
    { sourceId: 'hi-seed:pani', headword: 'पानी', pos: 'NOUN', glossDefault: 'water', frequencyRank: 120, translations: [{ sourceId: 'hi-seed:pani:en:1', body: 'water' }] },
    { sourceId: 'hi-seed:ghar', headword: 'घर', pos: 'NOUN', glossDefault: 'house, home', frequencyRank: 85, translations: [{ sourceId: 'hi-seed:ghar:en:1', body: 'house, home' }] },
    { sourceId: 'hi-seed:kitab', headword: 'किताब', pos: 'NOUN', glossDefault: 'book', frequencyRank: 340, translations: [{ sourceId: 'hi-seed:kitab:en:1', body: 'book' }] },
    { sourceId: 'hi-seed:bolna', headword: 'बोलना', pos: 'VERB', glossDefault: 'to speak, to say', frequencyRank: 210, translations: [{ sourceId: 'hi-seed:bolna:en:1', body: 'to speak' }, { sourceId: 'hi-seed:bolna:en:2', body: 'to say, to utter' }] },
    { sourceId: 'hi-seed:jana', headword: 'जाना', pos: 'VERB', glossDefault: 'to go', frequencyRank: 90, translations: [{ sourceId: 'hi-seed:jana:en:1', body: 'to go' }] },
    { sourceId: 'hi-seed:karna', headword: 'करना', pos: 'VERB', glossDefault: 'to do, to make', frequencyRank: 30, translations: [{ sourceId: 'hi-seed:karna:en:1', body: 'to do, to make' }] },
    { sourceId: 'hi-seed:hona', headword: 'होना', pos: 'VERB', glossDefault: 'to be, to become', frequencyRank: 5, translations: [{ sourceId: 'hi-seed:hona:en:1', body: 'to be, to become' }] },
    { sourceId: 'hi-seed:dekhna', headword: 'देखना', pos: 'VERB', glossDefault: 'to see, to look', frequencyRank: 95, translations: [{ sourceId: 'hi-seed:dekhna:en:1', body: 'to see, to look' }] },
    { sourceId: 'hi-seed:khana', headword: 'खाना', pos: 'VERB', glossDefault: 'to eat', frequencyRank: 250, translations: [{ sourceId: 'hi-seed:khana:en:1', body: 'to eat' }] },
    { sourceId: 'hi-seed:pina', headword: 'पीना', pos: 'VERB', glossDefault: 'to drink', frequencyRank: 380, translations: [{ sourceId: 'hi-seed:pina:en:1', body: 'to drink' }] },
    { sourceId: 'hi-seed:naam', headword: 'नाम', pos: 'NOUN', glossDefault: 'name', frequencyRank: 110, translations: [{ sourceId: 'hi-seed:naam:en:1', body: 'name' }] },
    { sourceId: 'hi-seed:kya', headword: 'क्या', pos: 'PRON', glossDefault: 'what', frequencyRank: 25, translations: [{ sourceId: 'hi-seed:kya:en:1', body: 'what' }] },
    { sourceId: 'hi-seed:aap', headword: 'आप', pos: 'PRON', glossDefault: 'you (formal)', frequencyRank: 50, translations: [{ sourceId: 'hi-seed:aap:en:1', body: 'you (formal)' }] },
    { sourceId: 'hi-seed:tum', headword: 'तुम', pos: 'PRON', glossDefault: 'you (informal)', frequencyRank: 60, translations: [{ sourceId: 'hi-seed:tum:en:1', body: 'you (informal)' }] },
    { sourceId: 'hi-seed:hain', headword: 'हैं', pos: 'AUX', glossDefault: 'are (3rd plural / formal)', frequencyRank: 8, translations: [{ sourceId: 'hi-seed:hain:en:1', body: 'are (3rd plural / formal)' }] },
    { sourceId: 'hi-seed:nahin', headword: 'नहीं', pos: 'PART', glossDefault: 'no, not', frequencyRank: 20, translations: [{ sourceId: 'hi-seed:nahin:en:1', body: 'no, not' }] },
    { sourceId: 'hi-seed:aur', headword: 'और', pos: 'CCONJ', glossDefault: 'and; more', frequencyRank: 12, translations: [{ sourceId: 'hi-seed:aur:en:1', body: 'and' }, { sourceId: 'hi-seed:aur:en:2', body: 'more, additional' }] },
    { sourceId: 'hi-seed:ki', headword: 'की', pos: 'ADP', glossDefault: 'of (feminine sg.)', frequencyRank: 7, translations: [{ sourceId: 'hi-seed:ki:en:1', body: 'of (feminine sg.)' }] },
    { sourceId: 'hi-seed:ka', headword: 'का', pos: 'ADP', glossDefault: 'of (masculine sg.)', frequencyRank: 6, translations: [{ sourceId: 'hi-seed:ka:en:1', body: 'of (masculine sg.)' }] },
    { sourceId: 'hi-seed:mein', headword: 'में', pos: 'ADP', glossDefault: 'in', frequencyRank: 10, translations: [{ sourceId: 'hi-seed:mein:en:1', body: 'in' }] },
  ],
};

const SOURCES = { 'hindi-seed': HINDI_SEED };

async function importSource(src) {
  console.log(`[import] running ${src.name} (${src.language}) — ${src.entries.length} entries`);
  let lemmasCreated = 0;
  let lemmasUpdated = 0;
  let translationsCreated = 0;
  let translationsUpdated = 0;

  for (const entry of src.entries) {
    // Upsert the lemma. Idempotency key: (language, source, source_id).
    const existing = await sql.unsafe(
      "SELECT id, curator_locked FROM lemmas WHERE language = $1 AND source = 'official_dictionary' AND source_id = $2 LIMIT 1",
      [src.language, entry.sourceId],
    );
    let lemmaId;
    if (existing.length === 0) {
      const inserted = await sql.unsafe(
        `INSERT INTO lemmas (language, headword, pos, script, gloss_default, frequency_rank, source, source_attribution, source_id, curator_locked, created_at, updated_at)
         VALUES ($1, $2, $3, 'Deva', $4, $5, 'official_dictionary', $6, $7, false, NOW(), NOW())
         RETURNING id`,
        [src.language, entry.headword, entry.pos, entry.glossDefault, entry.frequencyRank, src.attribution, entry.sourceId],
      );
      lemmaId = inserted[0].id;
      lemmasCreated++;
    } else if (existing[0].curator_locked) {
      // Honour curator lock — skip.
      lemmaId = existing[0].id;
    } else {
      lemmaId = existing[0].id;
      await sql.unsafe(
        `UPDATE lemmas SET headword = $2, pos = $3, gloss_default = $4, frequency_rank = $5, source_attribution = $6, updated_at = NOW() WHERE id = $1`,
        [lemmaId, entry.headword, entry.pos, entry.glossDefault, entry.frequencyRank, src.attribution],
      );
      lemmasUpdated++;
    }

    for (const tr of entry.translations) {
      const trExisting = await sql.unsafe(
        "SELECT id FROM translations WHERE lemma_id = $1 AND source = 'official_dictionary' AND source_id = $2 LIMIT 1",
        [lemmaId, tr.sourceId],
      );
      if (trExisting.length === 0) {
        await sql.unsafe(
          `INSERT INTO translations (lemma_id, source, body, target_language, source_attribution, source_id, hidden, created_at, updated_at)
           VALUES ($1, 'official_dictionary', $2, 'en', $3, $4, false, NOW(), NOW())`,
          [lemmaId, tr.body, src.attribution, tr.sourceId],
        );
        translationsCreated++;
      } else {
        await sql.unsafe(
          `UPDATE translations SET body = $2, source_attribution = $3, updated_at = NOW() WHERE id = $1`,
          [trExisting[0].id, tr.body, src.attribution],
        );
        translationsUpdated++;
      }
    }
  }

  await sql.unsafe(
    `INSERT INTO dictionary_imports (source_name, language, run_at, lemmas_created, lemmas_updated, lemmas_skipped_curator_locked, translations_created, translations_updated)
     VALUES ($1, $2, NOW(), $3, $4, 0, $5, $6)`,
    [src.name, src.language, lemmasCreated, lemmasUpdated, translationsCreated, translationsUpdated],
  );

  console.log(
    `[import] ${src.name} done — ${lemmasCreated} created / ${lemmasUpdated} updated lemmas, ` +
      `${translationsCreated} created / ${translationsUpdated} updated translations`,
  );
}

async function main() {
  const which = process.argv[2];
  const sources = which ? [SOURCES[which]] : Object.values(SOURCES);
  if (sources.some((s) => !s)) {
    console.error(`unknown source '${which}'. available: ${Object.keys(SOURCES).join(', ')}`);
    process.exit(1);
  }
  for (const src of sources) await importSource(src);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
