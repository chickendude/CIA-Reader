// One-shot seeder for the curator-side form_lemma_overrides rows
// (T-2.7). Stanza's Hindi UD model lemmatizes finite copulas (है,
// हैं, था, हूँ, …) to themselves rather than to होना; ditto for
// रहना's finite forms. The override table fixes those at processing
// time without baking the patch into the Python pipeline.
//
// Idempotent on (language, surface_nfc, context_signature='') —
// re-runs ON CONFLICT DO UPDATE the chosen_lemma_id so a curator
// edit to the override row sticks.
//
// Usage:
//   node apps/web/scripts/seed-form-overrides.mjs

import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import postgres from 'postgres';

loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://ciareader:ciareader@localhost:5432/ciareader';

const sql = postgres(DATABASE_URL, { max: 4, idle_timeout: 5 });

// surface → headword + pos. The headword must exist in the lemmas
// table; this script will look it up by (language, headword, pos).
// If the lemma is missing (the seed dictionary doesn't have it),
// the override row for that surface is skipped with a warning.
const HINDI_OVERRIDES = [
  // होना (to be) — finite forms.
  { surface: 'है', lemma: 'होना', pos: 'VERB' },
  { surface: 'हैं', lemma: 'होना', pos: 'VERB' },
  { surface: 'हूँ', lemma: 'होना', pos: 'VERB' },
  { surface: 'हो', lemma: 'होना', pos: 'VERB' },
  { surface: 'था', lemma: 'होना', pos: 'VERB' },
  { surface: 'थी', lemma: 'होना', pos: 'VERB' },
  { surface: 'थे', lemma: 'होना', pos: 'VERB' },
  { surface: 'थीं', lemma: 'होना', pos: 'VERB' },
  // रहना (to remain / to live) — same finite-form pattern.
  // We auto-create the lemma if it's not in the seed yet so the
  // override has a target.
  { surface: 'रहा', lemma: 'रहना', pos: 'VERB' },
  { surface: 'रही', lemma: 'रहना', pos: 'VERB' },
  { surface: 'रहे', lemma: 'रहना', pos: 'VERB' },
];

async function ensureLemma(language, headword, pos) {
  const existing = await sql.unsafe(
    'SELECT id FROM lemmas WHERE language = $1 AND headword = $2 AND pos = $3 LIMIT 1',
    [language, headword, pos],
  );
  if (existing.length > 0) return existing[0].id;
  const SCRIPT_FOR = { hi: 'Deva', mr: 'Deva', or: 'Orya' };
  const inserted = await sql.unsafe(
    `INSERT INTO lemmas (language, headword, pos, script, source, source_attribution, curator_locked, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'official_dictionary', 'CIA Reader override seed', false, NOW(), NOW())
     RETURNING id`,
    [language, headword, pos, SCRIPT_FOR[language]],
  );
  return inserted[0].id;
}

async function seedHindi() {
  let inserted = 0;
  let updated = 0;
  for (const o of HINDI_OVERRIDES) {
    const lemmaId = await ensureLemma('hi', o.lemma, o.pos);
    const result = await sql.unsafe(
      `INSERT INTO form_lemma_overrides (language, surface_nfc, context_signature, chosen_lemma_id, vote_count, promoted_at, note)
       VALUES ('hi', $1, '', $2, 0, NOW(), 'curator seed: Stanza UD lemmatization quirk')
       ON CONFLICT (language, surface_nfc, context_signature)
         DO UPDATE SET chosen_lemma_id = EXCLUDED.chosen_lemma_id, promoted_at = NOW()
       RETURNING (xmax = 0) AS inserted`,
      [o.surface, lemmaId],
    );
    if (result[0]?.inserted) inserted++;
    else updated++;
    console.log(
      `  ${o.surface.padEnd(6)} → ${o.lemma.padEnd(8)} (${o.pos})`,
    );
  }
  console.log(
    `[seed] hi form_lemma_overrides: ${inserted} created, ${updated} updated`,
  );
}

async function main() {
  await seedHindi();
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
