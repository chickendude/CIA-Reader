// Reconstruct clean suffix tables per paradigm from the Phase-B results.
// The raw derivation used longest-common-prefix stemming, which is broken
// by phonological sandhi (affricates) and short words. Here we:
//   1. reconstruct each exemplar's true surface forms (stem + rawSuffix),
//   2. re-stem with an explicit, paradigm-correct base rule,
//   3. emit suffix = surface - base (flag any form that doesn't cleanly
//      suffix as an exception, e.g. affricate prolative sandhi).

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const IN = resolve(DIR, 'basque-paradigms.json');
const OUT = resolve(DIR, 'basque-paradigms-clean.json');

// base rule from the caption label + the headword.
function baseFor(label, word) {
  const w = word.normalize('NFC');
  if (/a-stem/.test(label)) return w.replace(/a$/, ''); // drop article -a
  if (/ɾ-stem|r-stem/.test(label)) return w + 'r'; // r-doubling
  return w; // V/C/sib/affricate stems attach to the dict form
}

function reconstructForms(r) {
  const forms = {};
  for (const [tag, suf] of Object.entries(r.suffixes)) {
    if (suf.startsWith('=')) forms[tag] = suf.slice(1); // stored full form
    else forms[tag] = r.stem + suf;
  }
  return forms;
}

const data = JSON.parse(readFileSync(IN, 'utf8'));
// one representative result per caption label (prefer the one with the
// most forms and a non-sandhi headword).
const byLabel = new Map();
for (const r of data.results) {
  if (!byLabel.has(r.label) || Object.keys(r.suffixes).length > byLabel.get(r.label)._n) {
    byLabel.set(r.label, { ...r, _n: Object.keys(r.suffixes).length });
  }
}

const clean = [];
for (const r of byLabel.values()) {
  const forms = reconstructForms(r);
  const base = baseFor(r.label, r.word);
  const suffixes = {};
  const exceptions = {};
  for (const [tag, surface] of Object.entries(forms)) {
    if (surface.startsWith(base)) suffixes[tag] = surface.slice(base.length);
    else exceptions[tag] = surface; // sandhi / irregular for this exemplar
  }
  clean.push({
    label: r.label,
    exemplar: r.word,
    base,
    nSuffixes: Object.keys(suffixes).length,
    nExceptions: Object.keys(exceptions).length,
    suffixes,
    exceptions,
  });
}

clean.sort((a, b) => a.label.localeCompare(b.label));
writeFileSync(OUT, JSON.stringify(clean, null, 2));

// Print a compact view of the common cases for eyeballing.
const COMMON = ['absv|indef', 'absv|s', 'absv|p', 'absv|prox|p', 'erg|s', 'erg|p', 'dat|s', 'gen|s', 'gen|p', 'ine|s', 'ine|p', 'all|s', 'all|p', 'abl|s', 'ins|s', 'loc|s', 'pro|indef'];
for (const p of clean) {
  console.log(`\n[${p.label}]  exemplar=${p.exemplar}  base="${p.base}"  (${p.nSuffixes} forms, ${p.nExceptions} exceptions)`);
  console.log('  ' + COMMON.filter((c) => p.suffixes[c] !== undefined).map((c) => `${c}=${p.suffixes[c] || '∅'}`).join('  '));
  if (p.nExceptions) console.log('  exceptions: ' + Object.entries(p.exceptions).map(([k, v]) => `${k}→${v}`).join(', '));
}
console.log(`\nWrote ${OUT}`);
