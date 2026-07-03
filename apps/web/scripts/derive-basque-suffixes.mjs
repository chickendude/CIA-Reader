// Phase B: render one exemplar per paradigm bucket, extract its full
// declension, and derive the suffix table empirically.
//
// Each form cell in Wiktionary's rendered table carries a
// `<span class="... CASE|NUM-form-of">FORM</span>` tag and the caption
// names the paradigm ("inan a-stem"). We stem each word by the longest
// common prefix of its forms, so suffix = form - stem, then group words
// by their (caption label + suffix signature). Words that share a
// signature share a paradigm.
//
// Reads basque-paradigm-buckets.json (from the scrape), renders the top
// example of each bucket with count >= MINCOUNT, plus a few hand-picked
// validation words, and writes basque-paradigms.json.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const DIR = dirname(fileURLToPath(import.meta.url));
const BUCKETS = resolve(DIR, 'basque-paradigm-buckets.json');
const OUT = resolve(DIR, 'basque-paradigms.json');
const API = 'https://en.wiktionary.org/w/api.php';
const UA = 'ciareader-paradigm-research/0.1';
const MINCOUNT = 3;

async function renderHtml(title) {
  const url = API + '?' + new URLSearchParams({ action: 'parse', page: title, prop: 'text', format: 'json', formatversion: '2' });
  for (let a = 0; a < 4; a++) {
    try { const r = await fetch(url, { headers: { 'user-agent': UA } }); if (r.ok) { const j = await r.json(); return j.parse?.text || ''; } }
    catch { /* retry */ }
    await sleep(600 * (a + 1));
  }
  return '';
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, '').replace(/&#124;/g, '|').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim();
}

// Extract the eu declension table for a word: caption label + tag→form map.
function extractDeclension(html, title) {
  // Isolate the inflection table whose caption mentions this headword.
  const tables = html.split('<table').slice(1).map((t) => '<table' + t);
  for (const tbl of tables) {
    if (!/inflection-table/.test(tbl)) continue;
    const capM = tbl.match(/Declension of[\s\S]*?<small>\(([^)]+)\)<\/small>/);
    if (!capM) continue;
    const label = capM[1].trim();
    const forms = {};
    const spanRe = /<span class="Latn form-of lang-eu ([^"]+?)-form-of"[^>]*>([\s\S]*?)<\/span>/g;
    let m;
    while ((m = spanRe.exec(tbl))) {
      const tag = m[1].replace(/&#124;/g, '|').trim();
      const form = stripTags(m[2]);
      if (form && form !== '—' && form !== '—' && !(tag in forms)) forms[tag] = form;
    }
    if (Object.keys(forms).length >= 6) return { label, forms };
  }
  return null;
}

function longestCommonPrefix(arr) {
  if (!arr.length) return '';
  let p = arr[0];
  for (const s of arr.slice(1)) {
    let i = 0;
    while (i < p.length && i < s.length && p[i] === s[i]) i++;
    p = p.slice(0, i);
    if (!p) break;
  }
  return p;
}

// Derive stem (LCP) + suffix per tag. Ignore multiword forms for the LCP
// so a phrasal headword doesn't shorten the stem.
function deriveSuffixes(forms) {
  const surfaces = Object.values(forms).filter((f) => !/\s/.test(f));
  const stem = longestCommonPrefix(surfaces);
  const suffixes = {};
  for (const [tag, form] of Object.entries(forms)) {
    suffixes[tag] = form.startsWith(stem) ? form.slice(stem.length) : '=' + form; // '=' marks non-suffixal (irregular)
  }
  return { stem, suffixes };
}

function signature(suffixes) {
  return Object.keys(suffixes).sort().map((k) => `${k}:${suffixes[k]}`).join(',');
}

function pickExemplar(examples) {
  return examples.find((e) => /^[a-zñ]+$/i.test(e.normalize('NFC'))) || null;
}

async function main() {
  const data = JSON.parse(readFileSync(BUCKETS, 'utf8'));
  const buckets = [...data.nouns.buckets, ...data.adjs.buckets].filter((b) => b.count >= MINCOUNT);
  // hand-picked validation words the user cited
  const extra = ['badia', 'ilar', 'zabal', 'soineko', 'taberna', 'mendi', 'lagun', 'gizon', 'espainiera'];
  const jobs = [];
  for (const b of buckets) { const ex = pickExemplar(b.examples); if (ex) jobs.push({ word: ex, bucket: `${b.kind}|${b.code}|${b.ending}`, count: b.count }); }
  for (const w of extra) if (!jobs.some((j) => j.word === w)) jobs.push({ word: w, bucket: 'validation', count: 0 });

  const results = [];
  for (const job of jobs) {
    const html = await renderHtml(job.word);
    const dec = extractDeclension(html, job.word);
    if (!dec) { console.log(`  ${job.word.padEnd(16)} (${job.bucket}) — no table`); await sleep(200); continue; }
    const { stem, suffixes } = deriveSuffixes(dec.forms);
    results.push({ ...job, label: dec.label, stem, suffixes, sig: signature(suffixes), nForms: Object.keys(dec.forms).length });
    console.log(`  ${job.word.padEnd(16)} ${('[' + dec.label + ']').padEnd(20)} stem=${stem.padEnd(12)} bucket=${job.bucket}`);
    await sleep(200);
  }

  // Group by caption label.
  const byLabel = new Map();
  for (const r of results) {
    if (!byLabel.has(r.label)) byLabel.set(r.label, { label: r.label, members: [], reps: [] });
    const g = byLabel.get(r.label);
    g.members.push({ word: r.word, bucket: r.bucket, count: r.count, sig: r.sig });
    if (!g.reps.some((x) => x.sig === r.sig)) g.reps.push({ word: r.word, stem: r.stem, suffixes: r.suffixes, sig: r.sig });
  }

  console.log('\n=== PARADIGMS (caption label → suffix signatures) ===');
  for (const g of [...byLabel.values()].sort((a, b) => b.members.length - a.members.length)) {
    console.log(`\n[${g.label}]  (${g.members.length} exemplars, ${g.reps.length} distinct signature(s))`);
    console.log('  words: ' + g.members.map((m) => m.word).join(', '));
    for (const rep of g.reps) {
      console.log(`  via ${rep.word} (stem="${rep.stem}"):`);
      const keys = Object.keys(rep.suffixes).sort();
      console.log('    ' + keys.map((k) => `${k}=${rep.suffixes[k] || '∅'}`).join('  '));
    }
  }
  writeFileSync(OUT, JSON.stringify({ results, paradigms: [...byLabel.values()] }, null, 2));
  console.log(`\nWrote ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
