CREATE INDEX lemmas_language_spelling_idx ON lemmas (language, lower(normalize(headword)));
--> statement-breakpoint
CREATE INDEX lemma_forms_spelling_idx ON lemma_forms (lower(normalize(surface))) WHERE quarantined_at IS NULL;
--> statement-breakpoint
CREATE INDEX form_lemma_overrides_spelling_idx ON form_lemma_overrides (language, lower(normalize(surface_nfc))) WHERE context_signature = '';
