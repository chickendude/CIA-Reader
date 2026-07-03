// Loader: seed Basque declension paradigms (derived from Wiktionary by
// scrape-basque-paradigms.mjs → derive-basque-suffixes.mjs →
// clean-basque-paradigms.mjs) into the existing paradigms/paradigm_slots
// tables, assign a starter set of lemmas their (paradigm, stem), and
// regenerate lemma_forms. The dispatcher's lemma_forms → lemma tier then
// resolves every inflected surface (badian, badietara, mendebalerantz…)
// to its lemma — on top of Stanza, which still handles everything else.
//
// Idempotent: paradigms/slots upsert on their natural keys; each lemma's
// non-curator forms are wiped and regenerated (mirrors regenerateForms).
//
// Usage:  node apps/web/scripts/load-basque-paradigms.mjs

import { config as loadEnv } from 'dotenv';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import postgres from 'postgres';

const DIR = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(DIR, '..', '.env') });
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://ciareader:ciareader@localhost:5432/ciareader';
const sql = postgres(DATABASE_URL, { max: 4, idle_timeout: 5 });

// Derived suffix tables (Wiktionary caption label → tag → suffix).
const PARADIGMS = JSON.parse(
  readFileSync(resolve(DIR, 'data', 'basque-paradigms.json'), 'utf8'),
);

// Which caption labels to load now + the POS they seed under. (The
// data file also contains "both"/loanword variants we defer.)
const LOAD = {
  'inan a-stem': 'NOUN',
  'inan V-stem': 'NOUN',
  'inan C-stem': 'NOUN', // also covers sibilant/affricate + r-doubling nouns
  'anim a-stem': 'NOUN',
  'anim V-stem': 'NOUN',
  'anim C-stem': 'NOUN',
  'anim/inan V-stem': 'NOUN', // "both" animacy
  'anim/inan C-stem': 'NOUN',
  'inan sg-only a-stem': 'NOUN',
  'inan sg-only V-stem': 'NOUN',
  'adjective a-stem': 'ADJ',
  'adjective V-stem': 'ADJ',
  'adjective C-stem': 'ADJ', // also covers sibilant/affricate + -tar demonyms
};

// stem = base rule from the dict form, matching clean-basque-paradigms.mjs:
// a-stems drop the article -a; everything else attaches to the dict form.
// (The suffix tables were derived relative to exactly this base.)
function stemFor(label, headword, override) {
  if (override) return override.normalize('NFC');
  const w = headword.normalize('NFC');
  if (/a-stem/.test(label)) return w.replace(/a$/, '');
  // C-stem words ending in a (trill) -r double it in the stem
  // (ilar→ilarr, agur→agurr, aker→akerr, bilbotar→bilbotarr). Tap-r
  // words (ur, or → ɾ-stem) don't double and pass an explicit `stem`.
  if (/C-stem/.test(label) && /r$/.test(w)) return w + 'r';
  return w;
}

// Map a Wiktionary form tag (e.g. "absv|prox|p") to a stable slot_key
// and UD-ish features.
const CASE = {
  absv: 'Abs', erg: 'Erg', dat: 'Dat', gen: 'Gen', ine: 'Ine', all: 'All',
  abl: 'Abl', ins: 'Ins', com: 'Com', caus: 'Cau', ben: 'Ben', loc: 'Loc',
  ter: 'Ter', directive: 'Dir', destinative: 'Des', par: 'Par', pro: 'Pro',
};
function slotMeta(tag) {
  const parts = tag.split('|');
  const features = {};
  if (CASE[parts[0]]) features.Case = CASE[parts[0]];
  if (parts.includes('indef')) features.Definite = 'Ind';
  if (parts.includes('s')) { features.Number = 'Sing'; features.Definite = 'Def'; }
  if (parts.includes('p')) { features.Number = 'Plur'; features.Definite = 'Def'; }
  if (parts.includes('prox')) features.Deixis = 'Prox';
  if (parts.includes('animate')) features.Animacy = 'Anim';
  if (parts.includes('inanimate')) features.Animacy = 'Inan';
  return { slotKey: tag.replace(/\|/g, '_'), features };
}

// Starter lemma assignments — the reported over-strips (the ambiguous
// galera/ilaran are handled by the multi-lemma override work, not here).
const ASSIGN = [
  { hw: 'badia', pos: 'NOUN', label: 'inan a-stem', gloss: 'bay' },
  { hw: 'mendebal', pos: 'NOUN', label: 'inan C-stem', gloss: 'west' },
  { hw: 'espainiera', pos: 'NOUN', label: 'inan sg-only a-stem', gloss: 'Spanish (language)' },
  { hw: 'sorrera', pos: 'NOUN', label: 'inan a-stem', gloss: 'origin; birth' },
  { hw: 'aztarna', pos: 'NOUN', label: 'inan a-stem', gloss: 'trace; footprint' },
  { hw: 'mentura', pos: 'NOUN', label: 'inan a-stem', gloss: 'chance; fortune' },
  { hw: 'pare', pos: 'NOUN', label: 'inan V-stem', gloss: 'pair; equal' },
  { hw: 'arrasti', pos: 'NOUN', label: 'inan V-stem', gloss: 'afternoon; evening' },
  { hw: 'kari', pos: 'NOUN', label: 'inan V-stem', gloss: 'reason; motive' },
  { hw: 'bidegurutze', pos: 'NOUN', label: 'inan V-stem', gloss: 'crossroads' },
  // Validation exemplars for the newly-completed paradigms:
  { hw: 'agur', pos: 'NOUN', label: 'inan C-stem', gloss: 'greeting; farewell' }, // r-doubling → agurr
  { hw: 'arroz', pos: 'NOUN', label: 'inan C-stem', gloss: 'rice' }, // sibilant
  { hw: 'ur', pos: 'NOUN', label: 'inan C-stem', stem: 'ur', gloss: 'water' }, // tap-r, no doubling
  { hw: 'hartz', pos: 'NOUN', label: 'anim C-stem', gloss: 'bear' }, // affricate, animate
  { hw: 'aker', pos: 'NOUN', label: 'anim C-stem', gloss: 'billy goat' }, // r-doubling, animate → akerr
  { hw: 'bizi', pos: 'ADJ', label: 'adjective V-stem', gloss: 'alive; living' },
  { hw: 'bilbotar', pos: 'ADJ', label: 'adjective C-stem', gloss: 'of Bilbao' }, // -tar demonym → bilbotarr
];

async function upsertParadigm(label, pos, suffixes) {
  const [{ id }] = await sql`
    INSERT INTO paradigms (language, pos, name, description, created_at, updated_at)
    VALUES ('eu', ${pos}, ${'Basque ' + label}, ${'Derived from Wiktionary declension (' + label + ')'}, NOW(), NOW())
    ON CONFLICT (language, pos, name) DO UPDATE SET updated_at = NOW()
    RETURNING id`;
  let order = 0;
  const tags = Object.keys(suffixes);
  for (const tag of tags) {
    order += 10;
    const { slotKey, features } = slotMeta(tag);
    await sql`
      INSERT INTO paradigm_slots (paradigm_id, slot_key, features, suffix, sort_order)
      VALUES (${id}, ${slotKey}, ${sql.json(features)}, ${suffixes[tag]}, ${order})
      ON CONFLICT (paradigm_id, slot_key)
        DO UPDATE SET suffix = EXCLUDED.suffix, features = EXCLUDED.features, sort_order = EXCLUDED.sort_order`;
  }
  return { id, slotCount: tags.length };
}

async function ensureLemma(headword, pos, gloss) {
  // Deterministic pick: the eu dictionary has heavy per-source duplication
  // (Kaikki EN + ES + Stanza), so ORDER BY created_at keeps re-runs stable
  // and assigns the paradigm to the oldest (canonical import) row.
  const existing = await sql`SELECT id FROM lemmas WHERE language='eu' AND headword=${headword} AND pos=${pos} ORDER BY created_at ASC LIMIT 1`;
  if (existing.length) return existing[0].id;
  const [{ id }] = await sql`
    INSERT INTO lemmas (language, headword, pos, script, gloss_default, source, source_attribution, curator_locked, created_at, updated_at)
    VALUES ('eu', ${headword}, ${pos}, 'Latn', ${gloss ?? null}, 'official_dictionary', 'CIA Reader paradigm seed', false, NOW(), NOW())
    RETURNING id`;
  return id;
}

async function main() {
  // 1. Upsert the enabled paradigms + slots; keep a name→{id,suffixes} map.
  const byLabel = new Map();
  for (const p of PARADIGMS) {
    const pos = LOAD[p.label];
    if (!pos) continue;
    const { id, slotCount } = await upsertParadigm(p.label, pos, p.suffixes);
    byLabel.set(p.label, { id, pos, suffixes: p.suffixes });
    console.log(`  paradigm "Basque ${p.label}" (${pos}) — ${slotCount} slots`);
  }

  // 2. Assign lemmas + regenerate their forms.
  let totalForms = 0;
  for (const a of ASSIGN) {
    const para = byLabel.get(a.label);
    if (!para) { console.log(`  ! ${a.hw}: paradigm "${a.label}" not loaded`); continue; }
    const lemmaId = await ensureLemma(a.hw, a.pos, a.gloss);
    const stem = stemFor(a.label, a.hw, a.stem);
    await sql`UPDATE lemmas SET paradigm_id=${para.id}, stem=${stem}, updated_at=NOW() WHERE id=${lemmaId}`;

    // Wipe non-curator forms across ALL duplicate rows of this (headword,
    // pos) — the dictionary's per-source dupes mean a prior run may have
    // generated forms on a sibling row; clean them so no stale surfaces
    // linger. Then generate stem+suffix on the chosen row (deduped).
    await sql`
      DELETE FROM lemma_forms
      WHERE created_by <> 'curator'
        AND lemma_id IN (
          SELECT id FROM lemmas WHERE language='eu' AND headword=${a.hw} AND pos=${a.pos}
        )`;
    const slotIds = await sql`SELECT id, slot_key, features, suffix FROM paradigm_slots WHERE paradigm_id=${para.id}`;
    const seen = new Set();
    let n = 0;
    for (const s of slotIds) {
      const surface = (stem + s.suffix).normalize('NFC');
      if (seen.has(surface)) continue;
      seen.add(surface);
      await sql`
        INSERT INTO lemma_forms (lemma_id, surface, features, romanization, created_by, paradigm_slot_id, created_at)
        VALUES (${lemmaId}, ${surface}, ${sql.json(s.features)}, NULL, 'generator', ${s.id}, NOW())`;
      n++;
    }
    totalForms += n;
    console.log(`  ${a.hw.padEnd(14)} [${a.label}] stem="${stem}" → ${n} forms`);
  }
  console.log(`\n[done] ${byLabel.size} paradigms, ${ASSIGN.length} lemmas, ${totalForms} forms`);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
