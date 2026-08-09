// Deployable seed: Basque declension paradigms + inflected forms.
//
// Upserts the 13 derived paradigms (data/basque-paradigms.json) into the
// paradigms/paradigm_slots tables, assigns each Basque noun/adjective its
// (paradigm, stem) from data/basque-lemma-assignments.json (+ a seed list
// of the reported words), and (re)generates ~140k lemma_forms. The
// dispatcher's lemma_forms → lemma tier then resolves every inflected
// surface (badian, badietara, mendebalerantz…) to its lemma, on top of
// Stanza which still handles everything else.
//
// Idempotent + prod-safe: paradigms/slots upsert on their natural keys;
// prior 'generator' forms for eu are wiped and regenerated (curator /
// import / pipeline forms are preserved). A generated form whose surface
// is a *different* lemma's headword (homograph, e.g. `bizirik`) is
// quarantined so it can't shadow the standalone lexeme.
//
// Deploy sequence (paradigms attach to existing dictionary lemmas):
//   1. pnpm dictionary:import          # ensure the eu dictionary is loaded
//   2. pnpm seed:basque-paradigms      # this script
//   3. reprocess eu texts              # admin reprocess-batch endpoint,
//                                      # or scripts/reprocess-text.mjs <id>
//
// Regenerate the assignment data from a fresh scrape:
//   node scripts/scrape-basque-paradigms.mjs                 # → buckets.json
//   node scripts/build-basque-assignments.mjs buckets.json   # → data/*.json
//
// Usage:  pnpm --filter @ciareader/web seed:basque-paradigms

import { config as loadEnv } from 'dotenv';
import { readFileSync, existsSync } from 'node:fs';
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

// Seed lemma assignments — the reported over-strips + validation exemplars.
// These carry glosses and (for tap-r) an explicit stem, and are always
// applied even if the bulk scrape missed them. The bulk vocabulary is loaded
// from data/basque-lemma-assignments.json and merged below (seed wins).
const SEED_ASSIGN = [
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

// Merge the bulk scrape-derived assignments with the seed list. Seed entries
// win (glosses + explicit tap stems). Keyed on headword|pos. Each entry:
// { hw, pos, label, stem?, gloss? }.
const GLOSS = Object.fromEntries(SEED_ASSIGN.filter((a) => a.gloss).map((a) => [`${a.hw}|${a.pos}`, a.gloss]));
const ASSIGN_FILE = resolve(DIR, 'data', 'basque-lemma-assignments.json');
const BULK = existsSync(ASSIGN_FILE) ? JSON.parse(readFileSync(ASSIGN_FILE, 'utf8')) : [];
const merged = new Map();
for (const a of BULK) merged.set(`${a.hw}|${a.pos}`, { ...a });
for (const a of SEED_ASSIGN) {
  const key = `${a.hw}|${a.pos}`;
  merged.set(key, { hw: a.hw, pos: a.pos, label: a.label, stem: a.stem ?? merged.get(key)?.stem, gloss: a.gloss });
}
const ASSIGN = [...merged.values()];

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
  const t0 = Date.now();
  // 1. Upsert paradigms + slots; cache each paradigm's slots.
  const byLabel = new Map();
  const slotsByPara = new Map();
  for (const p of PARADIGMS) {
    const pos = LOAD[p.label];
    if (!pos) continue;
    const { id } = await upsertParadigm(p.label, pos, p.suffixes);
    byLabel.set(p.label, { id, pos });
    slotsByPara.set(p.label, await sql`SELECT id, features, suffix FROM paradigm_slots WHERE paradigm_id=${id}`);
  }
  console.log(`  ${byLabel.size} paradigms upserted`);

  // 2. Pre-load canonical (headword,pos)→id + the headword set (for the
  //    homograph guard). DISTINCT ON keeps the oldest row per (headword,pos)
  //    so re-runs are stable despite the dictionary's Kaikki duplicates.
  const lemRows = await sql`SELECT DISTINCT ON (headword, pos) id, headword, pos FROM lemmas WHERE language='eu' ORDER BY headword, pos, created_at ASC`;
  const idByKey = new Map();
  const headwordSet = new Set();
  for (const r of lemRows) { idByKey.set(`${r.headword}|${r.pos}`, r.id); headwordSet.add(r.headword); }
  console.log(`  ${idByKey.size} eu lemma slots, ${headwordSet.size} distinct headwords`);

  // 3. Wipe prior generator forms for eu (idempotent); keep curator/import/pipeline.
  const del = await sql`DELETE FROM lemma_forms WHERE created_by='generator' AND lemma_id IN (SELECT id FROM lemmas WHERE language='eu')`;
  console.log(`  cleared ${del.count ?? 0} prior generator forms`);

  // 4. Assign paradigm+stem per lemma and generate forms (batched insert).
  let created = 0, forms = 0, quarantined = 0, skipped = 0;
  const rowBuf = [];
  async function flush() {
    if (!rowBuf.length) return;
    await sql`INSERT INTO lemma_forms ${sql(rowBuf, 'lemma_id', 'surface', 'features', 'created_by', 'paradigm_slot_id', 'quarantined_at', 'quarantine_reason')}`;
    rowBuf.length = 0;
  }
  for (const a of ASSIGN) {
    const para = byLabel.get(a.label);
    if (!para) { skipped++; continue; }
    let id = idByKey.get(`${a.hw}|${a.pos}`);
    if (!id) {
      id = await ensureLemma(a.hw, a.pos, GLOSS[`${a.hw}|${a.pos}`]);
      idByKey.set(`${a.hw}|${a.pos}`, id);
      headwordSet.add(a.hw);
      created++;
    }
    const stem = stemFor(a.label, a.hw, a.stem);
    await sql`UPDATE lemmas SET paradigm_id=${para.id}, stem=${stem}, updated_at=NOW() WHERE id=${id}`;
    const seen = new Set();
    for (const s of slotsByPara.get(a.label)) {
      const surface = (stem + s.suffix).normalize('NFC');
      if (seen.has(surface)) continue;
      seen.add(surface);
      // Homograph guard: quarantine a generated form whose surface is a
      // DIFFERENT lemma's dictionary headword (e.g. `bizirik` = adverb, also
      // `bizi`'s partitive) so it can't shadow the standalone lexeme. Kept
      // (not deleted) so a curator can review; the dispatcher filters
      // quarantined rows out of resolution.
      const collide = headwordSet.has(surface) && surface !== a.hw;
      rowBuf.push({
        lemma_id: id,
        surface,
        features: s.features,
        created_by: 'generator',
        paradigm_slot_id: s.id,
        quarantined_at: collide ? new Date() : null,
        quarantine_reason: collide ? 'homograph: surface is another lemma headword' : null,
      });
      if (collide) quarantined++; else forms++;
      if (rowBuf.length >= 1000) await flush();
    }
  }
  await flush();
  console.log(
    `\n[done] ${ASSIGN.length} assignments (${created} new lemmas), ` +
      `${forms} forms + ${quarantined} quarantined (homograph), ${skipped} skipped — ${Math.round((Date.now() - t0) / 1000)}s`,
  );
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
