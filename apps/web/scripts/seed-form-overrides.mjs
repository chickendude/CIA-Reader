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

// Basque (eu) — Stanza's UD_Basque-BDT model lemmatizes these inflected
// forms wrong (verified against the live model): case/directional suffixes
// left unstripped, over-stripped, or mis-tagged as verbs. Fix them at the
// surface level until the Phase 3 suffix-rule tier (mirroring odia/morph.py)
// generalizes across whole inflection families.
//
// `gloss` seeds gloss_default when the lemma has to be created so the new
// dictionary entry isn't bare. `aspaldion` is a genuine lexeme of its own
// ("lately/recently"), distinct from `aspaldi` ("long ago"), so it maps to
// itself rather than being collapsed.
export const BASQUE_OVERRIDES = [
  { surface: 'parean', lemma: 'pare', pos: 'NOUN', gloss: 'pair; equal' },
  { surface: 'bidegurutzea', lemma: 'bidegurutze', pos: 'NOUN', gloss: 'crossroads' },
  { surface: 'arrastiko', lemma: 'arrasti', pos: 'NOUN', gloss: 'afternoon; evening' },
  { surface: 'mendebalerantz', lemma: 'mendebal', pos: 'NOUN', gloss: 'west' },
  { surface: 'badiara', lemma: 'badia', pos: 'NOUN', gloss: 'bay' },
  // Base/other inflected forms of the same stems that Stanza also gets
  // wrong (`badia`→`badi`, `mendebalera`→`mendebale`). Each is a
  // distinct surface, so it needs its own row until the Phase 3
  // suffix-rule tier generalizes across the paradigm.
  { surface: 'badia', lemma: 'badia', pos: 'NOUN', gloss: 'bay' },
  { surface: 'mendebalera', lemma: 'mendebal', pos: 'NOUN', gloss: 'west' },
  { surface: 'aspaldion', lemma: 'aspaldion', pos: 'ADV', gloss: 'lately; recently' },
  // Second batch of Stanza mislemmatizations (verified against the live
  // model). Over-strips, an unrecognized form, a -tzat prolative trio,
  // a context-unstable verbal noun, and one malformed seq2seq lemma
  // (`hamargarren` came back as the literal edit-script string
  // "hamaR+garren!"). The -tzat cases + the case/number over-strips are
  // interim fixes until the Phase 3 suffix-rule tier generalizes them.
  { surface: 'gurea', lemma: 'gure', pos: 'DET', gloss: 'our; ours' },
  { surface: 'aztarnak', lemma: 'aztarna', pos: 'NOUN', gloss: 'trace; footprint' },
  { surface: 'menturaz', lemma: 'mentura', pos: 'NOUN', gloss: 'chance; fortune' },
  { surface: 'kariaz', lemma: 'kari', pos: 'NOUN', gloss: 'reason; motive' },
  { surface: 'espainiera', lemma: 'espainiera', pos: 'NOUN', gloss: 'Spanish (language)' },
  { surface: 'sorrerako', lemma: 'sorrera', pos: 'NOUN', gloss: 'origin; birth' },
  { surface: 'ergeltzat', lemma: 'ergel', pos: 'ADJ', gloss: 'foolish; silly' },
  { surface: 'ezjakintzat', lemma: 'ezjakin', pos: 'ADJ', gloss: 'ignorant' },
  { surface: 'traidoretzat', lemma: 'traidore', pos: 'NOUN', gloss: 'traitor' },
  { surface: 'amaitzeaz', lemma: 'amaitu', pos: 'VERB', gloss: 'to finish; to end' },
  { surface: 'hamargarren', lemma: 'hamargarren', pos: 'ADJ', gloss: 'tenth' },
];

// Latin script is case-bearing and overrides match `token.surface` exactly,
// so a sentence-initial "Badiara" won't hit a lowercase "badiara" row. Seed
// the Title-case variant of each surface too. (The Phase 3 rule tier removes
// the need for this.)
/**
 * @template {{ surface: string }} T
 * @param {T[]} entries
 * @returns {T[]}
 */
export function withTitleCaseVariants(entries) {
  /** @type {T[]} */
  const out = [];
  for (const e of entries) {
    out.push(e);
    const title = e.surface.charAt(0).toUpperCase() + e.surface.slice(1);
    if (title !== e.surface) out.push({ ...e, surface: title });
  }
  return out;
}

/**
 * @param {string} language
 * @param {string} headword
 * @param {string} pos
 * @param {string | null} [gloss]
 * @returns {Promise<string | null>}
 */
async function ensureLemma(language, headword, pos, gloss = null) {
  const existing = await sql.unsafe(
    'SELECT id FROM lemmas WHERE language = $1 AND headword = $2 AND pos = $3 LIMIT 1',
    [language, headword, pos],
  );
  if (existing[0]) return existing[0].id;
  /** @type {Record<string, string>} */
  const SCRIPT_FOR = { hi: 'Deva', mr: 'Deva', or: 'Orya', eu: 'Latn' };
  const script = SCRIPT_FOR[language];
  if (!script) throw new Error(`No script mapping for language "${language}"`);
  const inserted = await sql.unsafe(
    `INSERT INTO lemmas (language, headword, pos, script, gloss_default, source, source_attribution, curator_locked, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'official_dictionary', 'CIA Reader override seed', false, NOW(), NOW())
     RETURNING id`,
    [language, headword, pos, script, gloss],
  );
  return inserted[0] ? inserted[0].id : null;
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

async function seedBasque() {
  let inserted = 0;
  let updated = 0;
  for (const o of withTitleCaseVariants(BASQUE_OVERRIDES)) {
    const lemmaId = await ensureLemma('eu', o.lemma, o.pos, o.gloss ?? null);
    const result = await sql.unsafe(
      `INSERT INTO form_lemma_overrides (language, surface_nfc, context_signature, chosen_lemma_id, vote_count, promoted_at, note)
       VALUES ('eu', $1, '', $2, 0, NOW(), 'curator seed: Stanza UD lemmatization quirk')
       ON CONFLICT (language, surface_nfc, context_signature)
         DO UPDATE SET chosen_lemma_id = EXCLUDED.chosen_lemma_id, promoted_at = NOW()
       RETURNING (xmax = 0) AS inserted`,
      [o.surface, lemmaId],
    );
    if (result[0]?.inserted) inserted++;
    else updated++;
    console.log(`  ${o.surface.padEnd(16)} → ${o.lemma.padEnd(14)} (${o.pos})`);
  }
  console.log(
    `[seed] eu form_lemma_overrides: ${inserted} created, ${updated} updated`,
  );
}

async function main() {
  await seedHindi();
  await seedBasque();
  await sql.end();
}

// Only connect + seed when run directly (`node seed-form-overrides.mjs`),
// so unit tests can import the pure helpers without opening a DB pool.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
