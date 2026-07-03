// One-off: derive the "adjective V-stem" paradigm (bizi, busti, … — the
// biggest adjective class) from Wiktionary and append it to
// data/basque-paradigms.json. The scrape/derive pass filtered it out via
// MINCOUNT + a render miss, so we add it directly here for completeness.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(DIR, 'data', 'basque-paradigms.json');
const API = 'https://en.wiktionary.org/w/api.php';

async function render(t) {
  const u = API + '?action=parse&page=' + encodeURIComponent(t) + '&prop=text&format=json&formatversion=2';
  const r = await fetch(u, { headers: { 'user-agent': 'ciareader-paradigm-research/0.1' } });
  const j = await r.json();
  return j.parse?.text || '';
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

const d = decl(await render('bizi'));
if (!d || !/adjective V-stem/.test(d.label)) {
  console.error('Unexpected label for bizi:', d?.label);
  process.exit(1);
}
const base = 'bizi';
const suffixes = {};
const exceptions = {};
for (const [tag, surface] of Object.entries(d.forms)) {
  if (surface.startsWith(base)) suffixes[tag] = surface.slice(base.length);
  else exceptions[tag] = surface;
}

const all = JSON.parse(readFileSync(DATA, 'utf8'));
if (all.some((p) => p.label === 'adjective V-stem')) {
  console.log('adjective V-stem already present — replacing.');
}
const filtered = all.filter((p) => p.label !== 'adjective V-stem');
filtered.push({
  label: 'adjective V-stem',
  exemplar: 'bizi',
  base,
  nSuffixes: Object.keys(suffixes).length,
  nExceptions: Object.keys(exceptions).length,
  suffixes,
  exceptions,
});
filtered.sort((a, b) => a.label.localeCompare(b.label));
writeFileSync(DATA, JSON.stringify(filtered, null, 2));
console.log(`Added adjective V-stem: ${Object.keys(suffixes).length} suffixes, ${Object.keys(exceptions).length} exceptions`);
console.log('  sample:', ['absv|s', 'absv|p', 'gen|p', 'ine|s', 'all|s', 'ins|s', 'pro|indef'].map((k) => `${k}=${suffixes[k] ?? '?'}`).join('  '));
