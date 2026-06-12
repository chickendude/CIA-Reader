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
| *Molesworth's A Dictionary, Marathi and English* (1857) | Public domain (DDSA) | Public domain | Planned — historical orthography will need light normalization |
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
