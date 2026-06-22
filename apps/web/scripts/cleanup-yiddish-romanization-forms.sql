-- One-time cleanup: delete Latin-script romanization junk from
-- `lemma_forms` for Yiddish lemmas.
--
-- WHY THIS IS A SCRIPT, NOT A DRIZZLE MIGRATION
-- ---------------------------------------------
-- The bug: the generic Kaikki importer treated a Wiktionary
-- `romanization`-tagged *form* (`{ "form": "bemeshekh",
-- "tags": ["romanization"] }`) as a native-script inflected surface,
-- because the Latin string differs from the Hebrew-script headword and
-- slipped past the `surface !== headword` guard. For Yiddish this wrote
-- 31,339 Latin junk surfaces (`bemeshekh`, `zuntikn`, `religyes`, ...).
-- `kaikkiToImportEntry()` now skips romanization/transliteration forms,
-- so nothing new is written — but `insertForm` is append-only, so rows
-- written before the fix survive a re-import and must be cleaned once.
--
-- This is intentionally NOT a numbered drizzle migration. Yiddish ('yi')
-- support — the `language` enum value, the `kaikki-yiddish` source, and
-- the import that produced the junk — lives on a separate feature branch
-- whose merge order relative to this importer fix is not fixed. A
-- numbered migration here would (a) break `drizzle-kit migrate` on any
-- database whose `language` enum does not yet contain 'yi', and (b) run
-- exactly once, in migration order, with no guarantee of running *after*
-- the Yiddish import. So this is a manual, idempotent, run-once-after-
-- deploy operation instead.
--
-- The earlier quarantine pass (drizzle/0038_quarantine_lemma_form_junk.sql)
-- neutralised the same class of Latin junk for hi/mr/or, but predates
-- Yiddish, so 'yi' never got that treatment. Here we DELETE rather than
-- quarantine: a Hebrew-script language has no legitimate Latin-script
-- surface, and these rows are pure transliterations whose curated value
-- (if ever wanted) belongs in `lemma_forms.romanization`, not `surface`.
--
-- Safe to run more than once (a second run matches 0 rows). Curator-
-- authored rows (`created_by = 'curator'`) are never touched. The
-- pg_enum guard makes the script a no-op on databases that do not have
-- Yiddish, so it is safe to run anywhere.
--
-- Run with:
--   psql "$DATABASE_URL" -f apps/web/scripts/cleanup-yiddish-romanization-forms.sql
-- Verify (expect 0):
--   select count(*) from lemma_forms lf join lemmas l on l.id = lf.lemma_id
--   where l.language = 'yi' and lf.surface ~ '^[a-zA-Z]';

DO $$
DECLARE
  deleted_count bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'language' AND e.enumlabel = 'yi'
  ) THEN
    RAISE NOTICE 'language enum has no ''yi'' value — nothing to clean up; skipping.';
    RETURN;
  END IF;

  DELETE FROM lemma_forms lf
  USING lemmas l
  WHERE l.id = lf.lemma_id
    AND l.language = 'yi'
    AND lf.created_by <> 'curator'
    AND lf.surface ~ '[A-Za-z]';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % Latin-script lemma_forms surface row(s) for Yiddish.', deleted_count;
END $$;
