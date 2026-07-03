// Build the committed Basque lemma→paradigm assignment table from the
// Wiktionary scrape (scrape-basque-paradigms.mjs → basque-paradigm-buckets.json).
// Each entry maps a dictionary headword to the derived paradigm label + the
// stem the suffixes attach to, so load-basque-paradigms.mjs can assign
// paradigms + regenerate lemma_forms for the whole vocabulary.
//
// Usage:  node scripts/build-basque-assignments.mjs <buckets.json>
// Output: writes data/basque-lemma-assignments.json.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(DIR, 'data', 'basque-lemma-assignments.json');
const bucketsPath = process.argv[2];
if (!bucketsPath) {
  console.error('Usage: node build-basque-assignments.mjs <path-to-basque-paradigm-buckets.json>');
  process.exit(1);
}

// Phonological ending → stem class (matches scrape-basque-paradigms.mjs).
function stemClass(ending) {
  if (ending === 'a') return 'a-stem';
  if (ending === 'vowel') return 'V-stem';
  return 'C-stem'; // consonant / sib / sib_affricate / r
}

// Loanword/acronym modifiers we skip (rare, irregular orthography).
const SKIP_MODS = new Set(['ophyph', 'acr', 'orthv', 'md', 'ini', 'pr']);

// (kind, code, ending) → paradigm label + POS, or null to skip.
function paradigmFor(kind, code, ending) {
  const [base, ...mods] = code.split('.');
  if (mods.some((m) => SKIP_MODS.has(m))) return null;
  const sc = stemClass(ending);
  const isTap = mods.includes('tap');
  const isSg = mods.includes('sg');
  if (kind === 'adj') {
    // Adjective declension (incl. substantivised in/an demonyms) uses the
    // adjective paradigms — a/V/C-stem cover every ending.
    return { label: `adjective ${sc}`, pos: 'ADJ', isTap };
  }
  // nouns
  if (isSg) {
    if (sc === 'C-stem') return null; // no sg-only C-stem paradigm derived
    return { label: `inan sg-only ${sc}`, pos: 'NOUN', isTap };
  }
  if (base === 'in') return { label: `inan ${sc}`, pos: 'NOUN', isTap };
  if (base === 'an') return { label: `anim ${sc}`, pos: 'NOUN', isTap };
  if (base === 'both') {
    if (sc === 'a-stem') return null; // only V/C "both" paradigms derived
    return { label: `anim/inan ${sc}`, pos: 'NOUN', isTap };
  }
  // "(default)" animacy nouns are demonym-like → decline as adjectives.
  return { label: `adjective ${sc}`, pos: 'NOUN', isTap };
}

function computeStem(label, headword, isTap) {
  const w = headword.normalize('NFC');
  if (/a-stem/.test(label)) return w.replace(/a$/, '');
  // C-stem trill -r doubles in the stem (ilar→ilarr); tap -r (ur) doesn't.
  if (/C-stem/.test(label) && /r$/.test(w) && !isTap) return w + 'r';
  return w;
}

const data = JSON.parse(readFileSync(bucketsPath, 'utf8'));
const words = [...(data.nouns?.words ?? []), ...(data.adjs?.words ?? [])];

const assignments = [];
const seen = new Set();
const skipped = { multiword: 0, noParadigm: 0, dup: 0 };
for (const w of words) {
  const title = (w.title ?? '').normalize('NFC');
  if (!title || /\s/.test(title)) { skipped.multiword++; continue; } // phrases decline on the head; skip
  const p = paradigmFor(w.kind, w.code, w.ending);
  if (!p) { skipped.noParadigm++; continue; }
  const key = `${title}|${p.pos}`;
  if (seen.has(key)) { skipped.dup++; continue; }
  seen.add(key);
  assignments.push({ hw: title, pos: p.pos, label: p.label, stem: computeStem(p.label, title, p.isTap) });
}

assignments.sort((a, b) => a.hw.localeCompare(b.hw));
writeFileSync(OUT, JSON.stringify(assignments, null, 0));

// Summary.
const byLabel = {};
for (const a of assignments) byLabel[a.label] = (byLabel[a.label] ?? 0) + 1;
console.log(`Wrote ${assignments.length} assignments → ${OUT}`);
console.log(`Skipped: ${skipped.multiword} multiword, ${skipped.noParadigm} no-paradigm, ${skipped.dup} dup`);
console.log('Per paradigm:');
for (const [l, n] of Object.entries(byLabel).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${l}`);
