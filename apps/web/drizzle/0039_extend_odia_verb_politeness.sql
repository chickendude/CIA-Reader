-- Extend the Odia regular verb paradigm with explicit politeness
-- tiers for the 2nd person.
--
-- Standard Odia distinguishes three 2nd-person registers (the same
-- distinction holds across tenses; the verb endings overlap with
-- other slots because Odia disambiguates by pronoun, not morphology):
--
--   ତୁ (tu)      → 2sg informal/intimate           Politeness=Infm
--   ତୁମେ (tume)  → 2sg/2pl neutral default         (no Politeness marker)
--   ଆପଣ (āpaṇa)  → 2sg/2pl formal/honorific        Politeness=Form
--
-- The form-editor's grid layout stacks multiple cells with the same
-- (person, number) when their `Politeness` differs, so each register
-- shows up as a labelled row inside the same cell.
--
-- This migration:
--   1. Tags the existing 2pl slots ("tume" forms) as the neutral
--      default — features unchanged so the grid still places them
--      under (2, plur), but a `slot_key` rename makes the intent
--      explicit.
--   2. Adds 2sg-formal (`āpaṇa` forms; verb morphology overlaps with
--      3pl) and 2sg/2pl-informal slots where the present habitual
--      seed only had a single 2sg-fam tier.
--
-- Standard Odia does NOT distinguish inclusive vs exclusive 1pl —
-- that's a Sambalpuri-dialect / Marathi feature. The grammar_features
-- catalog ships Clusivity=In/Ex labels (so a future dialect-aware
-- paradigm can use them) but no slots are added here.

-- Present habitual: add 2sg-formal (matches 3pl ending) and 2pl-informal
INSERT INTO "paradigm_slots" ("paradigm_id", "slot_key", "features", "suffix", "sort_order") VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'pres_hab_2sg_form', '{"Tense":"Pres","Aspect":"Hab","Person":"2","Number":"Sing","Politeness":"Form"}'::jsonb, 'ନ୍ତି', 22),
  ('00000000-0000-0000-0000-0000000000a1', 'pres_hab_2pl_form', '{"Tense":"Pres","Aspect":"Hab","Person":"2","Number":"Plur","Politeness":"Form"}'::jsonb, 'ନ୍ତି', 26),
  ('00000000-0000-0000-0000-0000000000a1', 'pres_hab_2pl_infm', '{"Tense":"Pres","Aspect":"Hab","Person":"2","Number":"Plur","Politeness":"Infm"}'::jsonb, 'ୁ',     27);

-- Present progressive: 2sg/2pl politeness fan-out (informal + formal)
INSERT INTO "paradigm_slots" ("paradigm_id", "slot_key", "features", "suffix", "sort_order") VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'pres_prog_2sg_infm', '{"Tense":"Pres","Aspect":"Prog","Person":"2","Number":"Sing","Politeness":"Infm"}'::jsonb, 'ୁଛୁ',     35),
  ('00000000-0000-0000-0000-0000000000a1', 'pres_prog_2sg_form', '{"Tense":"Pres","Aspect":"Prog","Person":"2","Number":"Sing","Politeness":"Form"}'::jsonb, 'ୁଛନ୍ତି', 36),
  ('00000000-0000-0000-0000-0000000000a1', 'pres_prog_2pl_form', '{"Tense":"Pres","Aspect":"Prog","Person":"2","Number":"Plur","Politeness":"Form"}'::jsonb, 'ୁଛନ୍ତି', 37);

-- Past simple: 2sg/2pl politeness fan-out
INSERT INTO "paradigm_slots" ("paradigm_id", "slot_key", "features", "suffix", "sort_order") VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'past_2sg_infm', '{"Tense":"Past","Person":"2","Number":"Sing","Politeness":"Infm"}'::jsonb, 'ିଲୁ', 45),
  ('00000000-0000-0000-0000-0000000000a1', 'past_2sg_form', '{"Tense":"Past","Person":"2","Number":"Sing","Politeness":"Form"}'::jsonb, 'ିଲେ', 46),
  ('00000000-0000-0000-0000-0000000000a1', 'past_2pl_form', '{"Tense":"Past","Person":"2","Number":"Plur","Politeness":"Form"}'::jsonb, 'ିଲେ', 47);

-- Future: 2sg/2pl politeness fan-out
INSERT INTO "paradigm_slots" ("paradigm_id", "slot_key", "features", "suffix", "sort_order") VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'fut_2sg_infm', '{"Tense":"Fut","Person":"2","Number":"Sing","Politeness":"Infm"}'::jsonb, 'ିବୁ', 85),
  ('00000000-0000-0000-0000-0000000000a1', 'fut_2sg_form', '{"Tense":"Fut","Person":"2","Number":"Sing","Politeness":"Form"}'::jsonb, 'ିବେ', 86),
  ('00000000-0000-0000-0000-0000000000a1', 'fut_2pl_form', '{"Tense":"Fut","Person":"2","Number":"Plur","Politeness":"Form"}'::jsonb, 'ିବେ', 87);
