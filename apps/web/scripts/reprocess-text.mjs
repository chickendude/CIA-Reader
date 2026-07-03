// One-shot dev helper: re-run the in-process NLP dispatcher against
// a single text id. Bypasses the SvelteKit dev server entirely so a
// stale Vite cache can't keep a `pending` text stuck.
//
// Usage:
//   node apps/web/scripts/reprocess-text.mjs <textId>
//
// Reads DATABASE_URL + NLP_SERVICE_URL from the environment with the
// same defaults as $lib/server/env.ts.

import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';

loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

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

// Case-fold key for surface lookups — mirrors foldSurface() in
// in-process-dispatcher.ts so sentence-initial / all-caps inflected
// forms resolve to the same override / lemma_forms entry.
const foldSurface = (s) => s.normalize('NFC').toLowerCase();

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

  // T-2.7 form_lemma_overrides — wildcard rows pre-loaded.
  const overrideRows = await fetchAll(
    "SELECT surface_nfc, chosen_lemma_id FROM form_lemma_overrides WHERE language = $1 AND context_signature = ''",
    text.language,
  );
  const overridesBySurface = new Map();
  for (const r of overrideRows) {
    const key = foldSurface(r.surface_nfc);
    if (!overridesBySurface.has(key)) {
      overridesBySurface.set(key, r.chosen_lemma_id);
    }
  }
  console.log(
    `[reprocess] form_lemma_overrides loaded: ${overridesBySurface.size} surfaces`,
  );

  // lemma_forms surface tier (mirrors in-process-dispatcher.ts): a recorded
  // inflected form → its parent lemma. Excludes quarantined junk. Sits below
  // the context overrides but above Stanza's candidate guesses. This is how
  // paradigm-generated declensions (badietara → badia, …) resolve.
  const formRows = await fetchAll(
    `SELECT lf.surface, lf.lemma_id
       FROM lemma_forms lf
       JOIN lemmas l ON l.id = lf.lemma_id
      WHERE l.language = $1 AND lf.quarantined_at IS NULL`,
    text.language,
  );
  const formsBySurface = new Map();
  for (const r of formRows) {
    const key = foldSurface(r.surface);
    if (!formsBySurface.has(key)) formsBySurface.set(key, r.lemma_id);
  }
  console.log(`[reprocess] lemma_forms loaded: ${formsBySurface.size} surfaces`);

  // Primary script per language. Mirrors LANGUAGES[lang].script in
  // @ciareader/shared-types (the authoritative registry) — kept inline here
  // only because this standalone .mjs helper doesn't transpile the TS package.
  // Keep in sync when a language is added.
  const SCRIPT_FOR = { hi: 'Deva', mr: 'Deva', or: 'Orya', yi: 'Hebr', eu: 'Latn' };

  // Find-or-auto-create. Mirrors ensureLemma() in
  // lib/server/texts/in-process-dispatcher.ts: if Stanza gave us a
  // lemma string but the dictionary has no row, insert one tagged
  // sourceAttribution='Stanza UD' so curators can see it later.
  let createdCount = 0;
  async function ensureLemma(language, candidate) {
    const headword = (candidate?.lemma ?? '').trim();
    const pos = (candidate?.pos ?? '').trim() || 'X';
    if (!headword) return null;
    const existing = resolveCandidate({ lemma: headword, pos });
    if (existing) return existing;
    const inserted = await sql.unsafe(
      `INSERT INTO lemmas (language, headword, pos, script, source, source_attribution, curator_locked, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'official_dictionary', 'Stanza UD', false, NOW(), NOW())
       RETURNING id`,
      [language, headword, pos, SCRIPT_FOR[language]],
    );
    if (inserted.length > 0) {
      createdCount++;
      const id = inserted[0].id;
      byHeadwordPos.set(`${headword} ${pos}`, id);
      if (!byHeadword.has(headword)) byHeadword.set(headword, id);
      return id;
    }
    // Concurrent insert won the race — read it back.
    const found = await sql.unsafe(
      'SELECT id FROM lemmas WHERE language = $1 AND headword = $2 AND pos = $3 LIMIT 1',
      [language, headword, pos],
    );
    if (found.length > 0) {
      const id = found[0].id;
      byHeadwordPos.set(`${headword} ${pos}`, id);
      if (!byHeadword.has(headword)) byHeadword.set(headword, id);
      return id;
    }
    return null;
  }

  async function pickLemmaId(t, language) {
    if (!t.is_word) return null;
    // T-2.7 overrides win over Stanza.
    const override = overridesBySurface.get(foldSurface(t.surface));
    if (override) return override;
    // lemma_forms surface tier — paradigm-generated / curator-recorded forms.
    const fromForms = formsBySurface.get(foldSurface(t.surface));
    if (fromForms) return fromForms;
    for (const c of t.candidates ?? []) {
      const strict = byHeadwordPos.get(`${c.lemma} ${c.pos}`);
      if (strict) return strict;
    }
    for (const c of t.candidates ?? []) {
      const loose = byHeadword.get(c.lemma);
      if (loose) return loose;
    }
    const top = (t.candidates ?? [])[0];
    if (!top || !top.lemma) return null;
    return ensureLemma(language, top);
  }

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

      // Resolve / auto-create lemmas first (sequentially so duplicate
      // inserts don't race each other across tokens of the same lemma).
      const lemmaIds = [];
      for (const t of result.tokens) {
        lemmaIds.push(await pickLemmaId(t, text.language));
      }
      const rows = result.tokens.map((t, i) => {
        const lemmaId = lemmaIds[i];
        // Mirror the dispatcher: when a form_lemma_overrides row
        // resolved this surface, drop Stanza's discarded candidate so
        // the reader popup doesn't show it as a bogus second tab.
        const viaOverride =
          t.is_word &&
          (overridesBySurface.has(foldSurface(t.surface)) ||
            formsBySurface.has(foldSurface(t.surface)));
        return {
        chapterId: chapter.id,
        idx: t.idx,
        surface: t.surface,
        lemmaId,
        lemmaCandidates:
          viaOverride && lemmaId
            ? [{ lemmaId, features: (t.candidates && t.candidates[0]?.features) || {}, score: 1 }]
            : (t.candidates ?? []).map((c) => ({
                lemmaId: resolveCandidate(c),
                features: c.features ?? {},
                score: c.score,
              })),
        features: (t.candidates && t.candidates[0]?.features) || {},
        isAmbiguous: t.is_ambiguous,
        // If we resolved (or auto-created) a dictionary row, the token
        // is no longer "no dictionary match" even if Stanza initially
        // flagged it OOV.
        isOov: lemmaId ? false : t.is_oov,
        isWord: t.is_word,
        sentenceIdx: 0,
        romanization: t.romanization,
        numberForms: t.number_forms ?? null,
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
    console.log(
      `[reprocess] done — ${totalTokens} tokens written, ` +
        `${createdCount} new lemmas auto-created, status=ready`,
    );
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
