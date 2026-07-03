// Research tool: enumerate Basque nouns + adjectives on en.wiktionary,
// read each entry's declension template ({{eu-ndecl|...}} / {{eu-adecl|...}}),
// and bucket by (animacy code × headword ending class) to compile the
// set of distinct declension paradigms we need to seed.
//
// The declension forms themselves are computed by Wiktionary's Lua
// module from (animacy, ending), so the paradigm space = animacy code ×
// phonological ending class. This pass discovers those buckets + counts
// + example words; a second pass renders one exemplar per bucket to
// derive the actual suffix table.
//
// Usage:  node scrape-basque-paradigms.mjs [--limit N]  (default: all)
// Output: writes basque-paradigm-buckets.json next to this file.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const API = 'https://en.wiktionary.org/w/api.php';
const UA = 'ciareader-paradigm-research/0.1 (language-reader; contact dev)';
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), 'basque-paradigm-buckets.json');

const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg !== -1 ? parseInt(process.argv[limitArg + 1], 10) : Infinity;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(params) {
  const url = API + '?' + new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA } });
      if (r.ok) return r.json();
    } catch {
      /* retry */
    }
    await sleep(800 * (attempt + 1));
  }
  throw new Error('API failed: ' + url);
}

// POST variant for large title lists (avoids over-long GET URLs + is
// gentler on the API). Returns null on repeated failure so the caller
// can skip the batch rather than abort the whole run.
async function apiPost(params) {
  const body = new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (r.ok) return r.json();
    } catch {
      /* retry */
    }
    await sleep(800 * (attempt + 1));
  }
  return null;
}

async function enumerateCategory(cat) {
  const titles = [];
  let cont;
  do {
    const d = await api({
      action: 'query',
      list: 'categorymembers',
      cmtitle: cat,
      cmlimit: '500',
      cmnamespace: '0', // main namespace = actual entries
      ...(cont ? { cmcontinue: cont } : {}),
    });
    for (const m of d.query.categorymembers) titles.push(m.title);
    cont = d.continue?.cmcontinue;
    if (titles.length >= LIMIT) break;
    await sleep(120);
  } while (cont);
  return titles.slice(0, LIMIT);
}

function basqueSection(wikitext) {
  return (wikitext.match(/==Basque==([\s\S]*?)(\n==[^=]|$)/) || [])[1] || '';
}

function declTemplate(bq) {
  return (bq.match(/\{\{eu-[na]decl[^}]*\}\}/) || [])[0] || null;
}

// Extract the animacy/type code(s) from {{eu-ndecl|in.tap}} → "in.tap".
function declCode(tpl) {
  if (!tpl) return null;
  const inner = tpl.replace(/^\{\{eu-[na]decl\s*/, '').replace(/\}\}$/, '');
  const arg = inner.split('|')[1] ?? inner.split('|')[0] ?? '';
  return arg.trim() || '(default)';
}

// Phonological ending class — approximates the module's branching.
function endingClass(word) {
  const w = word.normalize('NFC');
  if (/a$/.test(w)) return 'a';
  if (/(tz|ts|tx)$/.test(w)) return 'sib_affricate';
  if (/[szx]$/.test(w)) return 'sib';
  if (/r$/.test(w)) return 'r';
  if (/[eiou]$/.test(w)) return 'vowel';
  return 'consonant';
}

async function fetchWikitextBatch(titles) {
  const d = await apiPost({
    action: 'query',
    prop: 'revisions',
    rvprop: 'content',
    rvslots: 'main',
    titles: titles.join('|'),
  });
  const out = new Map();
  if (!d?.query?.pages) return out; // batch failed — caller skips
  for (const p of d.query.pages) {
    out.set(p.title, p.revisions?.[0]?.slots?.main?.content || '');
  }
  return out;
}

async function processCategory(cat, kind) {
  console.log(`\n== ${cat} ==`);
  const titles = await enumerateCategory(cat);
  console.log(`  ${titles.length} entries`);
  const buckets = new Map(); // key -> { count, examples[] }
  const words = []; // per-word paradigm assignment records
  let noDecl = 0;
  let failed = 0;
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const wt = await fetchWikitextBatch(batch);
    if (wt.size === 0) { failed += batch.length; process.stdout.write(`\r  scanned ${Math.min(i + 50, titles.length)}/${titles.length} (skipped a failed batch)`); await sleep(400); continue; }
    for (const title of batch) {
      const bq = basqueSection(wt.get(title) || '');
      const tpl = declTemplate(bq);
      if (!tpl) { noDecl++; continue; }
      const code = declCode(tpl);
      const end = endingClass(title);
      const key = `${kind}|${code}|${end}`;
      if (!buckets.has(key)) buckets.set(key, { kind, code, ending: end, count: 0, examples: [] });
      const b = buckets.get(key);
      b.count++;
      if (b.examples.length < 8) b.examples.push(title);
      words.push({ title, kind, code, ending: end });
    }
    process.stdout.write(`\r  scanned ${Math.min(i + 50, titles.length)}/${titles.length}`);
    await sleep(120);
  }
  console.log(`\n  ${noDecl} entries had no declension template (skipped), ${failed} in failed batches`);
  return { buckets: [...buckets.values()].sort((a, b) => b.count - a.count), words, noDecl, failed, total: titles.length };
}

async function main() {
  const nouns = await processCategory('Category:Basque_nouns', 'noun');
  const adjs = await processCategory('Category:Basque_adjectives', 'adj');
  const all = [...nouns.buckets, ...adjs.buckets].sort((a, b) => b.count - a.count);
  console.log('\n=== PARADIGM BUCKETS (kind | code | ending → count) ===');
  for (const b of all) {
    console.log(
      `  ${(b.kind + ' | ' + b.code + ' | ' + b.ending).padEnd(34)} ${String(b.count).padStart(4)}   e.g. ${b.examples.slice(0, 5).join(', ')}`,
    );
  }
  writeFileSync(OUT, JSON.stringify({ nouns, adjs }, null, 2));
  console.log(`\nWrote ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
