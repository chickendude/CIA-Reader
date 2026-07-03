// Sample seeder for curated homograph overrides *with alternates*
// (feat/basque-homograph-alternates). Lets you exercise the "pickable
// alternate lemma tabs" feature by hand: it inserts a few Basque surfaces
// whose form_lemma_overrides row carries `alternate_lemma_ids` beside the
// chosen default, so the reader popup offers the alternates as parse tabs.
//
// This is a DEV/TEST convenience — distinct from the production curator seed
// in `seed-form-overrides.mjs`. The homographs below are illustrative; swap in
// whatever surfaces you want to demo.
//
// Idempotent on (language, surface_nfc, context_signature='') — re-runs update
// the chosen id AND the alternates.
//
// Usage:
//   node apps/web/scripts/seed-homograph-samples.mjs
//
// To SEE the tabs after seeding:
//   • Upload a NEW Basque text containing the surfaces (galera, ilaran, …) —
//     the in-app dispatcher loads alternates at process time; or
//   • Reprocess an existing Basque text that contains them:
//       node apps/web/scripts/reprocess-text.mjs <textId>
//     (reprocess-text.mjs also loads alternates, mirroring the dispatcher).

import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import postgres from 'postgres';

loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://ciareader:ciareader@localhost:5432/ciareader';

const sql = postgres(DATABASE_URL, { max: 4, idle_timeout: 5 });

// Each sample: the surface, its chosen (default) lemma, and the ordered
// alternates — most- to least-likely — the reader should offer as tabs.
// `gloss` seeds gloss_default when a lemma has to be created so the new entry
// isn't bare. These Basque homographs are genuine (a surface that legitimately
// parses to more than one lexeme):
//   galera : `galera` (loss/defeat) — also the inessive of `gale` (eagerness)
//   ilaran : inessive of `ilara` (queue/row) — also of `ilar` (bean/pea)
//   ordena : `ordena` (order/sequence), `ordena` (command), `ordena` (religious order)
const SAMPLES = [
  {
    surface: 'galera',
    chosen: { lemma: 'galera', pos: 'NOUN', gloss: 'loss; defeat' },
    alternates: [{ lemma: 'gale', pos: 'NOUN', gloss: 'eagerness; hunger' }],
  },
  {
    surface: 'ilaran',
    chosen: { lemma: 'ilara', pos: 'NOUN', gloss: 'queue; row' },
    alternates: [{ lemma: 'ilar', pos: 'NOUN', gloss: 'bean; pea' }],
  },
  {
    surface: 'ordena',
    chosen: { lemma: 'ordena', pos: 'NOUN', gloss: 'order; sequence' },
    alternates: [
      { lemma: 'agindu', pos: 'NOUN', gloss: 'command; order' },
      { lemma: 'ordena erlijioso', pos: 'NOUN', gloss: 'religious order' },
    ],
  },
];

/** Look up a lemma by (language, headword, pos), creating it if absent. */
async function ensureLemma(language, headword, pos, gloss = null) {
  const existing = await sql.unsafe(
    'SELECT id FROM lemmas WHERE language = $1 AND headword = $2 AND pos = $3 LIMIT 1',
    [language, headword, pos],
  );
  if (existing[0]) return existing[0].id;
  const SCRIPT_FOR = { hi: 'Deva', mr: 'Deva', or: 'Orya', eu: 'Latn' };
  const script = SCRIPT_FOR[language];
  if (!script) throw new Error(`No script mapping for language "${language}"`);
  const inserted = await sql.unsafe(
    `INSERT INTO lemmas (language, headword, pos, script, gloss_default, source, source_attribution, curator_locked, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'official_dictionary', 'CIA Reader homograph sample seed', false, NOW(), NOW())
     RETURNING id`,
    [language, headword, pos, script, gloss],
  );
  return inserted[0] ? inserted[0].id : null;
}

async function seedSamples() {
  let inserted = 0;
  let updated = 0;
  for (const s of SAMPLES) {
    const chosenId = await ensureLemma('eu', s.chosen.lemma, s.chosen.pos, s.chosen.gloss);
    const alternateIds = [];
    for (const a of s.alternates) {
      const id = await ensureLemma('eu', a.lemma, a.pos, a.gloss);
      if (id) alternateIds.push(id);
    }
    // Postgres uuid[] literal, e.g. '{id1,id2}'. Empty stays NULL-ish via [].
    const arrayLiteral = `{${alternateIds.join(',')}}`;
    const result = await sql.unsafe(
      `INSERT INTO form_lemma_overrides (language, surface_nfc, context_signature, chosen_lemma_id, alternate_lemma_ids, vote_count, promoted_at, note)
       VALUES ('eu', $1, '', $2, $3::uuid[], 0, NOW(), 'homograph sample seed: pickable alternate lemmas')
       ON CONFLICT (language, surface_nfc, context_signature)
         DO UPDATE SET chosen_lemma_id = EXCLUDED.chosen_lemma_id,
                       alternate_lemma_ids = EXCLUDED.alternate_lemma_ids,
                       promoted_at = NOW()
       RETURNING (xmax = 0) AS inserted`,
      [s.surface, chosenId, arrayLiteral],
    );
    if (result[0]?.inserted) inserted++;
    else updated++;
    const altStr = s.alternates.map((a) => a.lemma).join(', ') || '(none)';
    console.log(`  ${s.surface.padEnd(10)} → ${s.chosen.lemma.padEnd(16)} alt: ${altStr}`);
  }
  console.log(
    `[seed] eu homograph samples: ${inserted} created, ${updated} updated`,
  );
}

async function main() {
  await seedSamples();
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
