# Dictionary sources

CIA Reader's dictionary starts as an import of the best open-source lexical
resources for each MVP language and becomes our own authoritative dataset
over time through curator edits, community submissions, and promoted
crowdsourced corrections (T-6.7). Every row is provenance-tagged
(`source`, `source_attribution`, `source_id`) so we can always answer
"where did this come from and who last edited it."

This document is the ledger for every upstream source we import from —
what it is, who publishes it, its license, and any caveats that informed
our decision to include it. Curator-edited rows are marked `curator_locked = true`
and re-imports skip them by design.

## Hindi

| Source | Publisher | License | Status |
|---|---|---|---|
| [Hindi WordNet](http://www.cfilt.iitb.ac.in/wordnet/webhwn/) | CFILT, IIT Bombay | Research use, distributable with attribution | Planned for import — large (~40k synsets) |
| [Dbnary Hindi-English](http://kaiko.getalp.org/about-dbnary/) | GETALP / Univ. Grenoble Alpes | CC-BY-SA 3.0 | Planned |
| [Shabdanjali](http://ltrc.iiit.ac.in/onlineServices/Dictionaries/) | LTRC, IIIT Hyderabad | Non-commercial research use | Under review — license may restrict paid-tier use |
| [Wiktionary Hindi (via Kaikki.org)](https://kaikki.org/dictionary/Hindi/) | Wiktionary contributors | CC-BY-SA 3.0 | **Imported (T-3.10, 2026-04-28)** — fetched via `scripts/fetch-dictionary-sources.sh kaikki-hindi`, runs idempotently against `(language, source, source_id)`; `source_id` is `kaikki:hi:<word>:<pos>:<sha1(joined glosses)>` so a Wiktionary edit creates a fresh row |
| [Wiktionary English Translations sections (via Kaikki.org)](https://kaikki.org/dictionary/English/) | Wiktionary contributors | CC-BY-SA 3.0 | **Imported (T-3.10, 2026-04-28)** — inverted from English entries' `translations[]`; complements the per-language Hindi dump by surfacing every Hindi word that English Wiktionary lists as a translation target |
| **CIA Reader Hindi Seed** | CIA Reader | CC0-1.0 | **Imported (T-3.1)** — ~10 public-domain core vocabulary entries, bundled for bootstrapping the import runner |

Coverage: expected to be the best of the three MVP languages after
full imports land. Hindi WordNet alone gives us broad noun/adjective
coverage; Dbnary fills in glosses and translations.

## Marathi

| Source | Publisher | License | Status |
|---|---|---|---|
| Marathi WordNet | CFILT, IIT Bombay | Research use, distributable with attribution | Planned |
| [*Molesworth's A Dictionary, Marathi and English* (1857)](https://dsal.uchicago.edu/dictionaries/molesworth/) | Public domain (via DSAL) | Public domain | **Registered** (`dsal-molesworth`) — ~60k entries, acquired via `pnpm dsal:scrape dsal-molesworth && pnpm dsal:parse dsal-molesworth` (see "DSAL scraping"). `source_id = dsal:molesworth:<raw hw>:<page>:<ord>` keys on the 1857 print artifact so DSAL-side OCR corrections update rows in place. Headwords keep the 1857 orthography (NFC only) — nukta-strip matching absorbs common variants; a curator-reviewed spelling-fixup table plugs into the importer's normalizer seam later. POS markers are gender-based (`m`/`f`/`n` = noun) |
| [*Vaze's The Aryabhushan School Dictionary* (1911)](https://dsal.uchicago.edu/dictionaries/vaze/) | Public domain (via DSAL) | Public domain | **Registered** (`dsal-vaze`) — concise modern glosses complementing Molesworth's archaic long entries; same acquisition + source_id scheme (`dsal:vaze:…`) |
| Dbnary Marathi-English | GETALP / Univ. Grenoble Alpes | CC-BY-SA 3.0 | Planned |
| [Wiktionary Marathi (via Kaikki.org)](https://kaikki.org/dictionary/Marathi/) | Wiktionary contributors | CC-BY-SA 3.0 | **Imported (T-3.10, 2026-04-28)** — fetched via `scripts/fetch-dictionary-sources.sh kaikki-marathi`; thinner than Hindi (~5k entries) but a solid bootstrap before Marathi WordNet + Molesworth land |
| [Wiktionary English Translations sections (via Kaikki.org)](https://kaikki.org/dictionary/English/) | Wiktionary contributors | CC-BY-SA 3.0 | **Imported (T-3.10, 2026-04-28)** — inverted from English entries' `translations[]`; the highest-leverage Marathi expansion since English Wiktionary's Translations sections substantially out-cover the Marathi sub-corpus |

Coverage: medium. Molesworth is comprehensive but archaic; modern Marathi
WordNet is thinner than Hindi's. Expect more OOV tokens than Hindi at
launch.

## Odia

| Source | Publisher | License | Status |
|---|---|---|---|
| Odia WordNet | ISI Kolkata | Research use, distributable with attribution | Planned — the seed for T-2.3a's custom pipeline already draws from this |
| OdiaNLP resources | Community / various | Mixed (MIT / CC-BY) | Planned — curated subset only, per-entry license check required |
| [Wiktionary Odia (via Kaikki.org)](https://kaikki.org/dictionary/Odia/) | Wiktionary contributors | CC-BY-SA 3.0 | **Imported (T-3.10, 2026-04-28)** — fetched via `scripts/fetch-dictionary-sources.sh kaikki-odia`; the smallest Kaikki dump of the three MVP languages (~2k entries) but the first real Odia lexical data — proves the script-aware path works end-to-end with `Orya` |
| [Wiktionary English Translations sections (via Kaikki.org)](https://kaikki.org/dictionary/English/) | Wiktionary contributors | CC-BY-SA 3.0 | **Imported (T-3.10, 2026-04-28)** — inverted from English entries' `translations[]`; biggest Odia coverage uplift since Wiktionary's Odia sub-corpus is tiny but the English-side Translations sections include Odia targets generously |

**Coverage: sparse.** Open-source Odia lexical coverage is materially thinner
than Hindi or Marathi. We expect correspondingly more OOV tokens at launch
and lean harder on (a) the custom Odia morphological pipeline (T-2.3a) to
strip inflections and (b) the curator-led dictionary editor (T-3.7) +
community submissions (T-6.3) to fill gaps post-launch.

The Odia dictionary browse page (T-3.6) will carry a visible
**"coverage: sparse"** notice so users calibrate expectations.

## Yiddish

| Source | Publisher | License | Status |
|---|---|---|---|
| [Wiktionary Yiddish (via Kaikki.org)](https://kaikki.org/dictionary/Yiddish/) | Wiktionary contributors | CC-BY-SA 3.0 | **Registered** (`kaikki-yiddish`) — fetched via `scripts/fetch-dictionary-sources.sh kaikki-yiddish`; ~10k entries in standard YIVO orthography (pointed letters, װ/ױ/ײ ligature codepoints — the NLP lemma lookup folds ligatures so either spelling convention matches) |
| [Wiktionary English Translations sections (via Kaikki.org)](https://kaikki.org/dictionary/English/) | Wiktionary contributors | CC-BY-SA 3.0 | **Registered** (`kaikki-en-translations-yiddish`) — inverted from English entries' `translations[]`, sharing the same cached English dump as the HI/MR/OR importers |
| Comprehensive Yiddish-English Dictionary (Beinfeld/Bochner) | Indiana University Press | Proprietary | **Rejected** — commercial dictionary, no redistribution rights |
| Yiddish Book Center resources | Yiddish Book Center | Mixed, mostly all-rights-reserved | Not pursued for dictionary data; texts may be sourced individually where public domain |

Coverage: medium for core vocabulary. The loshn-koydesh (Hebrew/Aramaic-origin)
component is spelled etymologically and unpointed, so rule-based
romanization and affix-stripping both undershoot there — expect the
correction UX and curator edits to carry more weight than they do for
Hindi. The custom pipeline's seed lemma table
(`services/nlp/app/pipelines/yiddish/data/seed_lemmas.json`) bootstraps
the analyzer until this import lands in Postgres.

**Phonetic readings for loshn-koydesh.** Etymologically-spelled
Hebrew-origin words carry an explicit phonetic reading stored as YIVO
romanization (שבת → `shabes`, חלומות → `khaloymes`); a stored reading
beats the rule-based letter mapping everywhere romanization is shown.
Three fill paths: (1) the NLP seed ships readings for its own entries
(headword-level `romanization`, per-form `forms[].romanization`);
(2) curators record readings on `lemma_forms.romanization` in the
form editor — the text processor prefers a recorded reading for a
matching surface when (re)processing, so dictionary updates reach the
reader without code changes; (3) future community submissions. A
stored reading can also be rendered back into *vowelized Yiddish
orthography* via the YIVO→Hebrew transliterator (`shabes` → שאַבעס) if
we later want the phonetic respelling displayed natively.

**Spelling conventions.** Both digital Yiddish conventions circulate:
individual letter pairs (וו / וי / יי) and the U+05F0–U+05F2 ligature
codepoints (װ / ױ / ײ). Everything we *emit* (input transliteration,
seed data) uses letter pairs; everything we *match* (lemma lookups in
the NLP pipeline, the `headword_nukta_stripped` search/auto-create
fallback tier) folds both conventions — plus the floating pasekh
position in pasekh tsvey yudn — onto one key, so imports may keep
whatever convention the upstream source uses.

## Basque

| Source | Publisher | License | Status |
|---|---|---|---|
| [Wiktionary Basque (via Kaikki.org)](https://kaikki.org/dictionary/Basque/) | Wiktionary contributors | CC-BY-SA 3.0 | **Registered** (`kaikki-basque`) — fetched via `scripts/fetch-dictionary-sources.sh kaikki-basque`; standard Latin orthography. First Latin-script importer — proves the script-aware path doesn't assume a non-Latin script. Glosses in **English** (`targetLanguage: 'en'`). |
| [Wiktionary Spanish edition — "Vasco" (via Kaikki.org)](https://kaikki.org/eswiktionary/Vasco/) | Wiktionary contributors | CC-BY-SA 3.0 | **Registered** (`kaikki-basque-es`) — same Basque headwords glossed in **Spanish** (`targetLanguage: 'es'`); fetched via `scripts/fetch-dictionary-sources.sh kaikki-basque-es` (a non-English edition, so it uses the `fetch_kaikki_edition` helper). |
| [Wiktionary English Translations sections (via Kaikki.org)](https://kaikki.org/dictionary/English/) | Wiktionary contributors | CC-BY-SA 3.0 | **Registered** (`kaikki-en-translations-basque`) — inverted from English entries' `translations[]`, sharing the same cached English dump as the other importers |
| [Euskaltzaindiaren Hiztegia (Basque Academy dictionary)](https://www.euskaltzaindia.eus/) | Euskaltzaindia (Royal Academy of the Basque Language) | All rights reserved | **Not stored.** Surfaced **admin-only**, on-demand, as a monolingual reference/verification aid (`GET /api/v1/admin/basque-dictionary`); fetched + parsed server-side, short-cached, never written to `translations` or shown to readers. |
| Elhuyar Hiztegiak (eu-es / eu-en) | Elhuyar Fundazioa | Proprietary | **Not stored.** Same admin-only reference path as Euskaltzaindia above. |

Coverage: medium for core vocabulary. Basque is **Latin-script**, so there is
no romanization layer (the reader renders headwords as written). Morphology is
handled by the Stanza UD_Basque-BDT model rather than a custom analyzer or seed
lemma table; the Kaikki import supplies the dictionary glosses on top of that.
Because Stanza resolves inflections, the Basque importers run **root-forms-only**
(`rootFormsOnly: true`): they import only citation/root headwords and skip both
each entry's inflection table (`forms[]` → `lemma_forms`) and Wiktionary
"form-of" entries (e.g. *etxean* = "inessive of etxe"), so the dictionary holds
dictionary headwords, not declined/conjugated surfaces.
Basque is agglutinative with a rich case system, so expect inflected surfaces to
lemmatize back to a smaller set of citation forms — the curator editor (T-3.7)
and community submissions (T-6.3) fill gloss gaps post-launch as for the others.

Basque ships definitions in three "definition languages" (`translations.targetLanguage`):
**English** (`kaikki-basque`) and **Spanish** (`kaikki-basque-es`) from public CC-BY-SA
Wiktionary editions, plus **monolingual Basque** (`eu`) which has no open bulk source and
accrues via curators/community over time. The reader popup groups translations by
definition language, all shown by default and individually toggleable. A separate
admin-only verification panel surfaces Elhuyar / Euskaltzaindia lookups as a curation aid
(reference-only, never stored) — see the Basque rejected sources above.

## DSAL scraping

The Digital Dictionaries of South Asia (DSAL, dsal.uchicago.edu) offers
no bulk download, but its query CGI returns every match for a
beginning-with query in a single response (no pagination). The
`dsal-*` sources are therefore acquired by an **operator-run** scraper —
never by CI, `fetch-dictionary-sources.sh`, or the admin Re-fetch button
(those only verify the parsed artifact exists and point here):

```
pnpm dsal:scrape <slug>     # one request per initial letter, cached under
                            #   data/dictionaries/<slug>/scrape/ (gitignored)
pnpm dsal:parse <slug>      # offline: HTML → raw.jsonl (re-runnable, no network)
pnpm dictionary:import <slug>
```

Politeness parameters (see `src/lib/server/dictionary/dsal/scrape.ts`):
serial requests with a jittered ≥2 s delay, a User-Agent carrying a
contact address, retry-with-backoff on transient errors, and a hard
abort on 403/429. A full sweep is ~50 requests per dictionary (~200
total across all four).

Completeness checks are built into the parse step: every results page
declares its own "N results" count (compared against parsed entry
blocks per letter), and the final deduped total is checked against a
per-dictionary expected range. Both mismatches surface as warnings
before anyone imports.

Because the raw HTML responses are cached, parser fixes are a re-parse,
never a re-scrape.

**Licensing position.** DSAL's pages blanket-claim CC BY-NC-ND on their
digitizations — including the 1857 Molesworth. The project's recorded
position (since #382) is that a faithful digitization of a
public-domain text creates no new US copyright (Feist: no originality,
no sweat-of-the-brow), so the underlying PD dictionary text is what we
import, with attribution to DSAL as the digitizer on every row. Each
dictionary's own copyright status is assessed in its ledger row.

## Cross-source duplication

Multiple sources may ship the same `(language, headword, pos)` triple —
Hindi WordNet and Kaikki could each define "किताब / NOUN", with different
glosses and provenance. The schema's `(language, headword, pos)` index
is **non-unique on purpose** (T-3.10): each source creates its own
`lemmas` row, and curators reconcile duplicates via the existing T-3.7
merge UI. Don't try to deduplicate at import time — the import path
must remain idempotent on `(language, source, source_id)` only.

## Re-import policy

The importer is idempotent:

1. Rows are matched on `(language, source, source_id)`.
2. If a matched row has `curator_locked = true`, the importer skips it
   and increments the `lemmasSkippedCuratorLocked` counter in the run
   summary. A curator can unlock a row in the dictionary editor (T-3.7)
   if they want to accept a fresh upstream payload over their edit.
3. Otherwise the row is updated in place.
4. Every run appends an audit row to `dictionary_imports` with
   created / updated / skipped counts so re-imports are auditable.

Forms (`lemma_forms`) are append-only at MVP — re-running an importer
that ships forms will add duplicate rows if the upstream source ships
the same form twice. The dedup pass is deliberately deferred to
post-MVP; today we'd rather over-include than lose a form.

## Admin UI (T-3.14)

`/moderation/dictionary/sources` is an admin-only page that surfaces
the cache + import state of every registered importer. Each row shows:

- **Raw cache**: presence + size + line count + mtime of
  `apps/web/data/dictionaries/<slug>/raw.jsonl`. A `partial` state
  means a `.tmp` file is present without a final `raw.jsonl` — someone
  interrupted a fetch.
- **Last import**: most recent `dictionary_imports` row for the slug
  (succeeded / failed, run-at, error message if any, triggering user).
- **Contribution**: live count of lemmas + translations whose
  `source_attribution` matches the importer's attribution string.

Per-row actions: **Re-fetch** (shells out to
`scripts/fetch-dictionary-sources.sh <slug> --force` in the background),
**Re-import** (runs the in-process importer against the cached file and
writes a `dictionary_imports` audit row, including a `failed` row with
`error_message` if the iterator throws), and **Delete cache** (`unlink`
the canonical `raw.jsonl`). A global **Fetch all missing** triggers a
fetch for every row currently in `Not cached`.

Job state is tracked in-process (single web replica in prod). The page
polls `/api/v1/admin/dictionary-sources` every 2 s while any row has a
running job; idle pages don't poll.

## Attribution surface

Every imported lemma and translation stores a `source_attribution` string
(e.g. `"Hindi WordNet, CFILT IIT-Bombay (research use; attribution required)"`).
This string appears:

- On the reader pop-up as a small badge per translation (T-3.8).
- On the dictionary browse page's detail view (T-3.6).
- On a `/credits` page linked from the footer, aggregated by source.

If you're adding a new importer, the attribution string is **required** —
if you don't know what to write, ask before merging.
