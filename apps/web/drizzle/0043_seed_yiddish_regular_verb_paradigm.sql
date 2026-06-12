-- Seed the "Yiddish regular verb" paradigm.
--
-- Lemmas like שרײַבן (shraybn, "to write") opt in by setting
-- `lemmas.paradigm_id` to the row created here and `lemmas.stem` to the
-- conjugation stem (for שרײַבן that is שרײַב — the infinitive minus the
-- final ־ן).
--
-- Slot suffixes are appended to the stem with no transformation, same
-- as the Odia paradigm. Coverage notes:
--
--   * This paradigm models the ־ן infinitive class. Verbs whose
--     infinitive takes ־ען after a stem-final נ / מ / syllabic cluster
--     (לערנען, עפֿענען) get their own paradigm row later, exactly like
--     Odia handles irregular classes.
--   * The past participle (גע־ + stem + ־ט for weak verbs) is a
--     *prefixed* form and the slot generator is suffix-only, so it is
--     deliberately absent here. The NLP pipeline's morphological
--     analyzer handles גע־ circumfix forms at read time
--     (services/nlp/app/pipelines/yiddish/morph.py); curators can add
--     participles as per-form overrides until the generator learns
--     prefixes.
--   * 3sg and 2pl share ־ט, and 1pl/3pl share the infinitive's ־ן —
--     Yiddish disambiguates by pronoun, not morphology, so the reader
--     popup may show several feature sets for one surface. Same
--     situation as the overlapping Odia endings.
--
-- Hardcoded UUID so downstream seeds + tests can reference the paradigm
-- by id without round-tripping through the database.

INSERT INTO "paradigms" ("id", "language", "pos", "name", "description") VALUES
  (
    '00000000-0000-0000-0000-0000000000b1',
    'yi',
    'VERB',
    'Yiddish regular verb',
    'Regular Yiddish verb pattern (־ן infinitive class): stem + person/number suffixes for the present tense, plus infinitive and imperative. Past participles (גע־ prefix) are handled by the NLP morphological analyzer, not the suffix generator.'
  );

INSERT INTO "paradigm_slots" ("paradigm_id", "slot_key", "features", "suffix", "sort_order") VALUES
  -- Infinitive (identical surface to 1pl/3pl present)
  ('00000000-0000-0000-0000-0000000000b1', 'inf', '{"VerbForm":"Inf"}'::jsonb, 'ן', 10),

  -- Present tense
  ('00000000-0000-0000-0000-0000000000b1', 'pres_1sg', '{"Tense":"Pres","Person":"1","Number":"Sing"}'::jsonb, '',   20),
  ('00000000-0000-0000-0000-0000000000b1', 'pres_2sg', '{"Tense":"Pres","Person":"2","Number":"Sing"}'::jsonb, 'סט', 21),
  ('00000000-0000-0000-0000-0000000000b1', 'pres_3sg', '{"Tense":"Pres","Person":"3","Number":"Sing"}'::jsonb, 'ט',  22),
  ('00000000-0000-0000-0000-0000000000b1', 'pres_1pl', '{"Tense":"Pres","Person":"1","Number":"Plur"}'::jsonb, 'ן',  23),
  ('00000000-0000-0000-0000-0000000000b1', 'pres_2pl', '{"Tense":"Pres","Person":"2","Number":"Plur"}'::jsonb, 'ט',  24),
  ('00000000-0000-0000-0000-0000000000b1', 'pres_3pl', '{"Tense":"Pres","Person":"3","Number":"Plur"}'::jsonb, 'ן',  25),

  -- Imperative (singular = bare stem, plural = stem + ט)
  ('00000000-0000-0000-0000-0000000000b1', 'imp_sg', '{"Mood":"Imp","Number":"Sing"}'::jsonb, '',  30),
  ('00000000-0000-0000-0000-0000000000b1', 'imp_pl', '{"Mood":"Imp","Number":"Plur"}'::jsonb, 'ט', 31);
