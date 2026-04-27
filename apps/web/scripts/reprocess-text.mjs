// One-shot dev helper: re-run the in-process NLP dispatcher against
// a single text id. Bypasses the SvelteKit dev server entirely so a
// stale Vite cache can't keep a `pending` text stuck.
//
// Usage:
//   node apps/web/scripts/reprocess-text.mjs <textId>
//
// Reads DATABASE_URL + NLP_SERVICE_URL from the environment with the
// same defaults as $lib/server/env.ts.

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://ciareader:ciareader@localhost:5432/ciareader';
const NLP_SERVICE_URL = process.env.NLP_SERVICE_URL ?? 'http://localhost:8000';

const textId = process.argv[2];
if (!textId) {
  console.error('Usage: node reprocess-text.mjs <textId>');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 4, idle_timeout: 5 });

async function fetchOne(query, ...params) {
  const rows = await sql.unsafe(query, params);
  return rows[0] ?? null;
}

async function fetchAll(query, ...params) {
  return sql.unsafe(query, params);
}

async function nlpProcess(language, text) {
  const res = await fetch(`${NLP_SERVICE_URL}/process`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ language, text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`NLP service ${res.status}: ${body || res.statusText}`);
  }
  return res.json();
}

async function main() {
  const text = await fetchOne(
    'SELECT id, language, title, status FROM texts WHERE id = $1',
    textId,
  );
  if (!text) {
    console.error(`text ${textId} not found`);
    process.exit(2);
  }
  console.log(
    `[reprocess] text "${text.title}" (${text.language}) currently ${text.status}`,
  );

  const chapters = await fetchAll(
    'SELECT id, idx, body FROM text_chapters WHERE text_id = $1 ORDER BY idx',
    textId,
  );
  console.log(`[reprocess] ${chapters.length} chapter(s)`);

  // Pre-load lemma index for the language. Two maps:
  //   byHeadwordPos: strict (headword, pos) → id
  //   byHeadword:    loose headword → id (first row wins)
  // The strict map matches real Stanza output; the loose map covers
  // the stub pipeline (which emits pos='X' for everything) and
  // the rare cases where Stanza's POS disagrees with the dictionary.
  const lemmas = await fetchAll(
    'SELECT id, headword, pos FROM lemmas WHERE language = $1',
    text.language,
  );
  const byHeadwordPos = new Map();
  const byHeadword = new Map();
  for (const r of lemmas) {
    byHeadwordPos.set(`${r.headword} ${r.pos}`, r.id);
    if (!byHeadword.has(r.headword)) byHeadword.set(r.headword, r.id);
  }
  const resolveCandidate = (c) =>
    byHeadwordPos.get(`${c.lemma} ${c.pos}`) ??
    byHeadword.get(c.lemma) ??
    null;
  console.log(
    `[reprocess] lemma index: ${byHeadwordPos.size} strict / ${byHeadword.size} loose`,
  );

  // Mark processing.
  await sql.unsafe(
    "UPDATE texts SET status = 'processing', status_error = NULL, updated_at = NOW() WHERE id = $1",
    [textId],
  );
  await sql.unsafe(
    "UPDATE nlp_jobs SET status = 'processing', started_at = NOW() WHERE text_id = $1",
    [textId],
  );

  let totalTokens = 0;
  try {
    for (const chapter of chapters) {
      console.log(`[reprocess] chapter ${chapter.idx} (${chapter.id}) — calling NLP...`);
      const result = await nlpProcess(text.language, chapter.body);
      console.log(`[reprocess]   got ${result.tokens.length} tokens back`);

      const rows = result.tokens.map((t) => {
        // Strict-POS first across every candidate, then loose by
        // headword. Mirrors lib/server/texts/in-process-dispatcher.ts.
        let lemmaId = null;
        for (const c of t.candidates ?? []) {
          lemmaId = resolveCandidate(c);
          if (lemmaId) break;
        }
        return {
        chapterId: chapter.id,
        idx: t.idx,
        surface: t.surface,
        lemmaId,
        lemmaCandidates: (t.candidates ?? []).map((c) => ({
          lemmaId: resolveCandidate(c),
          features: c.features ?? {},
          score: c.score,
        })),
        features: (t.candidates && t.candidates[0]?.features) || {},
        isAmbiguous: t.is_ambiguous,
        isOov: t.is_oov,
        isWord: t.is_word,
        sentenceIdx: 0,
        romanization: t.romanization,
        };
      });

      // Idempotency: clear existing tokens before insert.
      await sql.unsafe(
        'DELETE FROM text_tokens WHERE chapter_id = $1',
        [chapter.id],
      );
      // Postgres caps a single statement at 65534 bound parameters.
      // ~10 cols per row → safe batch is floor(65000 / cols). Use
      // 1000 to leave plenty of headroom.
      const BATCH = 1000;
      for (let off = 0; off < rows.length; off += BATCH) {
        const slice = rows.slice(off, off + BATCH);
        const cols = Object.keys(slice[0]);
        const placeholders = slice
          .map(
            (_, ri) =>
              '(' +
              cols
                .map((__, ci) => `$${ri * cols.length + ci + 1}`)
                .join(', ') +
              ')',
          )
          .join(', ');
        const values = slice.flatMap((r) =>
          cols.map((c) => {
            const v = r[c];
            if (v === null || v === undefined) return null;
            if (Array.isArray(v) || typeof v === 'object') return JSON.stringify(v);
            return v;
          }),
        );
        const cleanCols = cols.map((c) => c.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase()));
        await sql.unsafe(
          `INSERT INTO text_tokens (${cleanCols.join(', ')}) VALUES ${placeholders}`,
          values,
        );
      }
      totalTokens += rows.length;
    }
    await sql.unsafe(
      "UPDATE texts SET status = 'ready', status_error = NULL, updated_at = NOW() WHERE id = $1",
      [textId],
    );
    await sql.unsafe(
      "UPDATE nlp_jobs SET status = 'completed', finished_at = NOW() WHERE text_id = $1",
      [textId],
    );
    console.log(`[reprocess] done — ${totalTokens} tokens written, status=ready`);
  } catch (e) {
    const message = String(e?.message ?? e).slice(0, 1000);
    await sql.unsafe(
      "UPDATE texts SET status = 'failed', status_error = $2, updated_at = NOW() WHERE id = $1",
      [textId, message],
    );
    await sql.unsafe(
      "UPDATE nlp_jobs SET status = 'failed', error = $2, finished_at = NOW() WHERE text_id = $1",
      [textId, message],
    );
    console.error('[reprocess] FAILED:', message);
    process.exitCode = 3;
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
