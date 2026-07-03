// Re-derive a single paradigm's suffix table from a chosen Wiktionary
// exemplar and replace it in data/basque-paradigms.json. Useful when the
// original scrape picked a poor exemplar (e.g. an r-final adjective whose
// doubled r got baked into the suffixes instead of the stem).
//
// Usage:  node scripts/regen-basque-paradigm.mjs <word> "<exact caption label>"
//   e.g.  node scripts/regen-basque-paradigm.mjs desberdin "adjective C-stem"

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(DIR, 'data', 'basque-paradigms.json');
const API = 'https://en.wiktionary.org/w/api.php';

const word = process.argv[2];
const expectLabel = process.argv[3];
if (!word || !expectLabel) {
  console.error('Usage: node regen-basque-paradigm.mjs <word> "<caption label>"');
  process.exit(1);
}

async function render(t) {
  const u = API + '?action=parse&page=' + encodeURIComponent(t) + '&prop=text&format=json&formatversion=2';
  const r = await fetch(u, { headers: { 'user-agent': 'ciareader-paradigm-research/0.1' } });
  return (await r.json()).parse?.text || '';
}
function decl(html) {
  for (const tbl of html.split('<table').slice(1).map((t) => '<table' + t)) {
    if (!/inflection-table/.test(tbl)) continue;
    const cap = tbl.match(/Declension of[\s\S]*?<small>\(([^)]+)\)<\/small>/);
    if (!cap) continue;
    const forms = {};
    const re = /<span class="Latn form-of lang-eu ([^"]+?)-form-of"[^>]*>([\s\S]*?)<\/span>/g;
    let m;
    while ((m = re.exec(tbl))) {
      const tag = m[1].replace(/&#124;/g, '|').trim();
      const f = m[2].replace(/<[^>]+>/g, '').replace(/&#124;/g, '|').trim();
      if (f && f !== '—' && !(tag in forms)) forms[tag] = f;
    }
    return { label: cap[1].trim(), forms };
  }
  return null;
}

const d = decl(await render(word));
if (!d) { console.error('No declension table for', word); process.exit(1); }
if (d.label !== expectLabel) {
  console.error(`Label mismatch: ${word} is [${d.label}], expected [${expectLabel}]`);
  process.exit(1);
}
// base rule: a-stems drop the article -a; everything else = dict form
// (r-doubling is applied at load time via the stem, not baked into suffixes).
const base = /a-stem/.test(d.label) ? word.replace(/a$/, '') : word;
const suffixes = {};
const exceptions = {};
for (const [tag, surface] of Object.entries(d.forms)) {
  if (surface.startsWith(base)) suffixes[tag] = surface.slice(base.length);
  else exceptions[tag] = surface;
}

const all = JSON.parse(readFileSync(DATA, 'utf8'));
const next = all.filter((p) => p.label !== expectLabel);
next.push({ label: expectLabel, exemplar: word, base, nSuffixes: Object.keys(suffixes).length, nExceptions: Object.keys(exceptions).length, suffixes, exceptions });
next.sort((a, b) => a.label.localeCompare(b.label));
writeFileSync(DATA, JSON.stringify(next, null, 2));
console.log(`Re-derived [${expectLabel}] from ${word} (base="${base}"): ${Object.keys(suffixes).length} suffixes, ${Object.keys(exceptions).length} exceptions`);
console.log('  ' + ['absv|s', 'absv|p', 'gen|p', 'ins|s', 'pro|indef'].map((k) => `${k}=${suffixes[k] ?? '?'}`).join('  '));
