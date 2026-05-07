# Curator paradigm + form editor — follow-ups

Tracks the work that was deliberately scoped out of the
`feat/curator-paradigm-form-editor` PR
([#422](https://github.com/chickendude/CIA-Reader/pull/422)) so the
PR could land at a reviewable size. Each item below is a candidate
for its own PR.

## Curator UX gaps

- [ ] **Paradigm editor UI.** Today paradigms are added via SQL
      migrations (`apps/web/drizzle/0037_seed_odia_regular_verb_paradigm.sql`
      is the template). A `/moderation/paradigms` page should
      list paradigms (filter by language + POS), let admins create
      a new paradigm, and let them add / edit / reorder slots
      with key=value features. Without this, every new paradigm
      requires a developer round-trip.
- [ ] **Type-ahead form search wire-up.** The repository function
      `searchFormsByPrefix` ([apps/web/src/lib/server/dictionary/lemma-forms.ts](../apps/web/src/lib/server/dictionary/lemma-forms.ts))
      is shipped + tested but not wired to a UI. Add an admin
      search box (probably on `/moderation/dictionary`) that
      hits a small JSON endpoint and returns matching lemmas
      keyed by inflected form.
- [ ] **Quarantine review queue.** ~101k existing `lemma_forms`
      rows were flagged in the
      `0038_quarantine_lemma_form_junk` migration. Build a
      `/moderation/dictionary/quarantine` page so a curator can
      triage them: bulk-delete junk, salvage IAST-in-surface rows
      by moving the value into `romanization` + recovering the
      Devanagari/Odia from another source.
- [ ] **Community report queue.** Wire `lemma_form_proposals` (a
      new table) so a reader can submit "the form `rahili` belongs
      to lemma `ରହିବା`" or "this form is missing" from the popup.
      Resolve in a moderation surface that includes the source
      sentence + a deep link to the chapter.
- [ ] **Audit row on lemma delete.** Today `deleteLemma` doesn't
      write a history entry — the lemma row is gone, so a
      `lemma_id` FK can't anchor the audit. Two options: (a) make
      the FK nullable + write a row with a snapshot in `change`;
      (b) add a `prev_lemma_id` text column that survives delete.
- [ ] **Per-cell edit doesn't lock the lemma.** Inline-edit
      surfaces (`patchLemmaField`) call `updateLemma` which sets
      `curatorLocked = true`. Form-cell edits via `editForm` do
      NOT touch the lemma. Decide whether form-only edits should
      lock too, since they represent a curator's claim on the
      paradigm.

## Paradigm coverage

- [ ] **Hindi regular verb paradigm.** Modeled on the Odia seed,
      with Hindi-specific schwa-deletion rules in the generator's
      `combine` step (today it's plain string concat).
- [ ] **Marathi regular verb paradigm.** Includes the Marathi
      inclusive/exclusive 1pl distinction (Clusivity=In/Ex),
      which the `grammar_features` catalog already labels but
      no paradigm uses yet.
- [ ] **Noun paradigms.** Per language: Hindi noun (consonant /
      ā-stem / ī-stem), Marathi noun (with gender + case
      agreement), Odia noun (oblique case forms).
- [ ] **Adjective paradigms.** Hindi: gender × number agreement
      on inflectable adjectives (-ā / -ī / -e endings). Marathi:
      same, plus oblique forms.
- [ ] **Pronoun + auxiliary paradigms.** Closed sets, mostly
      hand-listed; one paradigm per language.
- [ ] **Irregular-verb handling.** Either (a) a separate paradigm
      per irregular verb (one row, one lemma) or (b) a `manual`
      flag that disables regenerate so curators free-edit the
      whole form list. Pick before adding ~100 irregulars across
      the three languages.

## Visual + UX polish

- [ ] **Paradigm-editor header strip.** Right now the curator
      edits `lemmas.paradigm_id` + `lemmas.stem` in a small bar
      below the Forms section heading. Once the paradigm-editor
      UI exists, link the paradigm name in that bar to its edit
      page so a curator can jump from "applying" to "defining"
      a paradigm in one click.
- [ ] **Empty-cell inline create.** When a `(person × politeness,
      number)` grid cell is empty (`—`), clicking it should let
      the curator add a form for that exact slot — the slot's
      features pre-fill the new form's blob.
- [ ] **Bulk-import IAST → script.** Some quarantined rows are
      legitimate IAST romanizations that should live in
      `lemma_forms.romanization`. A migration/script could
      heuristically pair each IAST row with its native-script
      sibling (same lemma, opposite script).
- [ ] **NLP romanize endpoint test.** `services/nlp/app/main.py`
      gained a `/romanize` route but no unit test in
      `services/nlp/tests/`. Add one that round-trips the seeded
      Odia + Hindi + Marathi alphabets.

## Schema / data hygiene

- [ ] **Generated-rows index on `paradigm_slot_id`.** When a slot
      is removed from a paradigm, the FK cascades to SET NULL on
      the form rows referencing it. A periodic cleanup or an
      "orphan generator forms" view would help triage rows whose
      provenance is now unclear.
- [ ] **`features` JSONB schema check.** Today any string can
      land in `lemma_forms.features` / `paradigm_slots.features`.
      A CHECK constraint or trigger validating that every key
      maps to a row in `grammar_features` would catch typos like
      `Tense=Pasr`.
- [ ] **Consolidate `lemma_forms.surface` index.** With the new
      filtered index `lemma_forms_surface_lookup_idx`, the older
      non-filtered `lemma_forms_surface_idx` is mostly redundant.
      Check `pg_stat_user_indexes` after a few weeks and drop
      whichever one isn't used.

## Cross-cutting

- [ ] **Drop reason from API endpoints.** The `Reason` UI inputs
      were removed from the lemma editor + bulk page in this PR,
      but the JSON API endpoints (`/api/v1/admin/lemmas/[id]`,
      `/api/v1/admin/translations/[id]`, etc.) still accept and
      persist `reason`. Decide whether to drop the field from
      those payloads too or keep it for programmatic clients.
- [ ] **Translations side of the curator page.** This PR's
      redesign focused on the lemma + forms area; the
      `Translations (N)` section retains the original styling.
      A pass to align typography + spacing with the new design
      would tie the page together.
