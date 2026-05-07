-- Seed the first paradigm: "Odia regular verb".
--
-- Lemmas like ରହିବା (rahibā) opt in by setting `lemmas.paradigm_id` to
-- the row created here and `lemmas.stem` to ର (or whatever the curator
-- determines is the consonant cluster before the conjugation suffix —
-- for ରହିବା that is `ରହ`).
--
-- Slot suffixes are appended to the stem with no transformation; the
-- generator does not implement sandhi rules. The Odia vowel-sign
-- mechanics handle the visible joins (e.g. `ର` + `ୁ` renders as ରୁ
-- because `ୁ` is U+0B41 ODIA VOWEL SIGN U, not the standalone vowel).
-- Irregular forms that don't fit the paradigm get a separate paradigm
-- row (or per-form curator overrides).
--
-- Hardcoded UUID so downstream seeds + tests can reference the
-- paradigm by id without round-tripping through the database.

INSERT INTO "paradigms" ("id", "language", "pos", "name", "description") VALUES
  (
    '00000000-0000-0000-0000-0000000000a1',
    'or',
    'VERB',
    'Odia regular verb',
    'Regular Odia verb pattern: stem + tense/aspect + person/number suffixes. Covers infinitive, present habitual, present progressive, past, past progressive, present/past perfect, future, future progressive, and imperative forms.'
  );

INSERT INTO "paradigm_slots" ("paradigm_id", "slot_key", "features", "suffix", "sort_order") VALUES
  -- Infinitive
  ('00000000-0000-0000-0000-0000000000a1', 'inf', '{"VerbForm":"Inf"}'::jsonb, 'ିବା', 10),

  -- Present habitual
  ('00000000-0000-0000-0000-0000000000a1', 'pres_hab_1sg',     '{"Tense":"Pres","Aspect":"Hab","Person":"1","Number":"Sing"}'::jsonb,                  'େ',       20),
  ('00000000-0000-0000-0000-0000000000a1', 'pres_hab_2sg_fam', '{"Tense":"Pres","Aspect":"Hab","Person":"2","Number":"Sing","Politeness":"Infm"}'::jsonb, 'ୁ',       21),
  ('00000000-0000-0000-0000-0000000000a1', 'pres_hab_2pl',     '{"Tense":"Pres","Aspect":"Hab","Person":"2","Number":"Plur"}'::jsonb,                  '',        22),
  ('00000000-0000-0000-0000-0000000000a1', 'pres_hab_3sg',     '{"Tense":"Pres","Aspect":"Hab","Person":"3","Number":"Sing"}'::jsonb,                  'େ',       23),
  ('00000000-0000-0000-0000-0000000000a1', 'pres_hab_1pl',     '{"Tense":"Pres","Aspect":"Hab","Person":"1","Number":"Plur"}'::jsonb,                  'ୁ',       24),
  ('00000000-0000-0000-0000-0000000000a1', 'pres_hab_3pl',     '{"Tense":"Pres","Aspect":"Hab","Person":"3","Number":"Plur"}'::jsonb,                  'ନ୍ତି',   25),

  -- Present progressive
  ('00000000-0000-0000-0000-0000000000a1', 'pres_prog_1sg', '{"Tense":"Pres","Aspect":"Prog","Person":"1","Number":"Sing"}'::jsonb, 'ୁଛି',    30),
  ('00000000-0000-0000-0000-0000000000a1', 'pres_prog_2pl', '{"Tense":"Pres","Aspect":"Prog","Person":"2","Number":"Plur"}'::jsonb, 'ୁଛ',     31),
  ('00000000-0000-0000-0000-0000000000a1', 'pres_prog_3sg', '{"Tense":"Pres","Aspect":"Prog","Person":"3","Number":"Sing"}'::jsonb, 'ୁଛି',    32),
  ('00000000-0000-0000-0000-0000000000a1', 'pres_prog_1pl', '{"Tense":"Pres","Aspect":"Prog","Person":"1","Number":"Plur"}'::jsonb, 'ୁଛୁ',    33),
  ('00000000-0000-0000-0000-0000000000a1', 'pres_prog_3pl', '{"Tense":"Pres","Aspect":"Prog","Person":"3","Number":"Plur"}'::jsonb, 'ୁଛନ୍ତି', 34),

  -- Past simple
  ('00000000-0000-0000-0000-0000000000a1', 'past_1sg', '{"Tense":"Past","Person":"1","Number":"Sing"}'::jsonb, 'ିଲି', 40),
  ('00000000-0000-0000-0000-0000000000a1', 'past_2pl', '{"Tense":"Past","Person":"2","Number":"Plur"}'::jsonb, 'ିଲ',  41),
  ('00000000-0000-0000-0000-0000000000a1', 'past_3sg', '{"Tense":"Past","Person":"3","Number":"Sing"}'::jsonb, 'ିଲା', 42),
  ('00000000-0000-0000-0000-0000000000a1', 'past_1pl', '{"Tense":"Past","Person":"1","Number":"Plur"}'::jsonb, 'ିଲୁ', 43),
  ('00000000-0000-0000-0000-0000000000a1', 'past_3pl', '{"Tense":"Past","Person":"3","Number":"Plur"}'::jsonb, 'ିଲେ', 44),

  -- Past progressive (3sg illustrative; user's source table only listed the canonical form)
  ('00000000-0000-0000-0000-0000000000a1', 'past_prog_3sg', '{"Tense":"Past","Aspect":"Prog","Person":"3","Number":"Sing"}'::jsonb, 'ୁଥିଲା', 50),

  -- Present perfect / past perfect
  ('00000000-0000-0000-0000-0000000000a1', 'pres_perf', '{"Tense":"Pres","Aspect":"Perf"}'::jsonb, 'ିଛି',     60),
  ('00000000-0000-0000-0000-0000000000a1', 'past_perf', '{"Tense":"Past","Aspect":"Perf"}'::jsonb, 'ିଥିଲା', 70),

  -- Future
  ('00000000-0000-0000-0000-0000000000a1', 'fut_1sg', '{"Tense":"Fut","Person":"1","Number":"Sing"}'::jsonb, 'ିବି', 80),
  ('00000000-0000-0000-0000-0000000000a1', 'fut_2pl', '{"Tense":"Fut","Person":"2","Number":"Plur"}'::jsonb, 'ିବ',  81),
  ('00000000-0000-0000-0000-0000000000a1', 'fut_3sg', '{"Tense":"Fut","Person":"3","Number":"Sing"}'::jsonb, 'ିବ',  82),
  ('00000000-0000-0000-0000-0000000000a1', 'fut_1pl', '{"Tense":"Fut","Person":"1","Number":"Plur"}'::jsonb, 'ିବୁ', 83),
  ('00000000-0000-0000-0000-0000000000a1', 'fut_3pl', '{"Tense":"Fut","Person":"3","Number":"Plur"}'::jsonb, 'ିବେ', 84),

  -- Future progressive
  ('00000000-0000-0000-0000-0000000000a1', 'fut_prog', '{"Tense":"Fut","Aspect":"Prog"}'::jsonb, 'ୁଥିବ', 90),

  -- Imperative
  ('00000000-0000-0000-0000-0000000000a1', 'imperative_familiar', '{"Mood":"Imp","Politeness":"Infm"}'::jsonb, '',        100),
  ('00000000-0000-0000-0000-0000000000a1', 'imperative_polite',   '{"Mood":"Imp","Politeness":"Form"}'::jsonb, 'ନ୍ତୁ', 101);
